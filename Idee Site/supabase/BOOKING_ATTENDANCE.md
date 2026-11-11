# Prezența la rezervare și emailurile aferente

Migrarea 034 este aplicată în Supabase din 11 noiembrie 2026. Workerul `booking-notifications` versiunea 9 este activ; toate cele patru fișiere din pachet au fost comparate cu sursa testată. Scenariul Make 7938404, versiunea 15, acceptă noul tip de notificare. Instalarea nu a marcat rezervări și nu a creat notificări de prezență în proiectul live. Nu s-a publicat pe Netlify.

Administratorii verificați pot marca „S-a prezentat” sau „Nu s-a prezentat” în Program & Disponibilitate și în istoricul rezervărilor finalizate. O rezervare cu mai multe ore poate fi marcată numai după încheierea ultimei ore păstrate. Rezervările anulate integral și blocările terenului nu sunt eligibile. Administratorul obișnuit are acces numai la ID-urile terenurilor alocate în prezent; superadminul poate verifica toate terenurile.

Migrarea `034_booking_attendance.sql` se aplică o singură dată după 033. Tabelele de prezență și audit sunt private, cu RLS și fără drepturi directe pentru rolurile API. Funcțiile publice `get_booking_attendance(uuid[])` și `set_booking_attendance(uuid,text,integer)` verifică din nou contul confirmat și alocarea terenului. Browserul transmite doar rezervarea, alegerea și revizia afișată; nu poate transmite un destinatar, un contor sau textul emailului.

## Contorul comun

Neprezentările confirmate și anulările târzii intră în același total. O rezervare se numără cel mult o dată, inclusiv dacă administratorul marchează absența pentru orele rămase după o anulare parțială târzie. Conturile sunt identificate prin UUID Auth; oaspeții sunt identificați separat prin email normalizat. O adresă declarată de un oaspete nu atribuie abateri contului cu aceeași adresă.

Panoul „Abateri clienți” păstrează perioada de 30 de zile pentru evenimentele afișate și marcajul de verificare de la trei evenimente recente. Insigna arată totalul istoric autorizat pentru administratorul respectiv. Emailul clientului folosește totalul global al identității, înghețat la înregistrarea evenimentului. Anulările făcute de personal rămân excluse.

O modificare a prezenței păstrează istoricul de audit. Corectarea în „S-a prezentat” elimină neprezentarea din total, păstrând o eventuală anulare târzie deja înregistrată pentru aceeași rezervare. Salvarea repetată a aceleiași alegeri nu adaugă evenimente sau emailuri. O revizie depășită nu poate suprascrie alegerea altui administrator.

Textul comun de avertizare este:

> La mai mult de 3 neprezentări sau anulări târzii, riști închiderea contului.

Nu se aplică suspendări sau închideri automate de conturi.

## Emailul de prezență

Tipul privat `booking_attendance_client` are două modele: avertizare de neprezentare și confirmare a corectării. Marcarea inițială „S-a prezentat” nu trimite email. Neprezentarea pune o notificare în outbox; corectarea unei absențe pune o notificare explicită de corectare. Evenimentele vechi încă netrimise, depășite de o nouă revizie, sunt omise la preluarea din outbox. Un mesaj deja predat furnizorului nu poate fi retras.

Destinatarul unui cont este recitit din Auth confirmat, nu dintr-o adresă a browserului. Pentru un oaspete se folosește contactul rezervării, fără a fi atașat ulterior unui cont cu același email. Emailul include baza/terenul, data, intervalul și totalul abaterilor; nu include o capabilitate de anulare și nu comunică o închidere efectivă de cont.

Notificările noi folosesc scenariul Make existent **7938404**, prin workerul `booking-notifications`. Transformarea reproductibilă este în `scripts/make-attendance.mjs`: adaugă doar filtrul nou, păstrând rutele, conexiunile Gmail, destinatarii dinamici, procesarea secvențială, confidențialitatea și deduplicarea existente. Nu este creat un webhook separat. Acceptarea webhookului reprezintă predarea către Make, nu confirmarea livrării în inbox.

Anulările târzii noi păstrează numărul lor specific și primesc separat și totalul comun. Snapshoturile și notificările vechi rămân compatibile. Migrarea nu inventează prezența pentru rezervările existente și nu pune emailuri istorice în coadă.

## Verificări

Testele `booking-attendance.test.cjs` și `booking-attendance-browser.test.cjs` folosesc PostgreSQL temporar și modulele reale: permisiuni, intervale în curs/viitoare, mai multe ore, repetări, corectări, audit, conturi versus oaspeți, anulări parțiale, contorul comun și afișare la 320/390/1440 px. Testele workerului verifică ambele emailuri, compatibilitatea notificărilor anterioare și blocarea datelor invalide. Nu sunt folosite rezervări reale sau adrese reale pentru probe.

## Inventar verificat la 11 noiembrie 2026

| Email | Declanșare și traseu |
|---|---|
| Confirmare rezervare, client și administrator | Rezervare creată → outbox Supabase → `booking-notifications` → Make **7938404** → Gmail |
| Anulare și avertizare de anulare târzie | Anulare confirmată → același traseu **7938404**; avertizarea și contoarele sunt generate de server |
| Neprezentare / corectarea prezenței | Alegerea administratorului după încheiere → același traseu **7938404**, numai către client |
| Bun venit | Prima activare eligibilă a unui cont → același traseu **7938404** |
| Mesaj de chat către client sau administratorul terenului | Mesaj nou → outbox → Make **7938798** → Gmail; scenariul este **oprit** la verificare |
| Anunț numai pentru clienți / numai pentru administratori | Superadmin → Setări → panoul de emailuri → rutele separate din **7938404** → Gmail |
| Resetarea parolei și confirmarea schimbării emailului | **Supabase Auth**, separat de Make |

Scenariul principal **7938404** este activ. Scenariile alternative vechi de anunț manual sunt **8377771** (clienți, activ) și **8377772** (administratori, oprit). Panoul superadminului folosește rutele din 7938404, nu depinde de aceste două scenarii alternative și nu trimite simultan prin ambele căi. Starea lor și starea chatului au fost păstrate.

Supabase Auth folosește serviciul implicit, fără SMTP personalizat; limita configurată este de două emailuri Auth pe oră. Înscrierile sunt confirmate automat, deci nu există în prezent un email distinct de confirmare a înscrierii. Bunul venit din Make este un mesaj separat.


## Corecția 035 — rezervări vechi și manuale

Corecția 035 este aplicată în Supabase. Verificarea live, exclusiv prin citire, confirmă eligibilitatea rezervărilor finalizate existente, atât grupate, cât și vechi/manuale. Instalarea nu a creat marcaje sau emailuri de neprezentare. Workerul versiunea 9 și ruta Make existentă sunt păstrate.

Migrarea `035_legacy_booking_attendance.sql` adaugă marcarea explicită pentru rezervările fără `booking_group_id`, fără să rescrie rândurile originale sau disponibilitatea. Prima marcare creează doar o legătură privată și evidența necesară contorului/emailului existent. Nu se trimit din nou confirmări de rezervare. Evidența aceasta este exclusă din limita de creare a rezervărilor de oaspeți; sunt păstrate exact cele două variante revizuite ale validării prețurilor și reîncercărilor.

Pentru un cont deja asociat rezervării se folosește emailul confirmat din Auth. Un client manual fără adresă completă primește un câmp „Emailul clientului”; administratorul îl completează înainte de marcare. Adresa introdusă nu atașează automat oaspetele unui cont cu același email și nu poate înlocui destinatarul unei rezervări deja identificate.

Butoanele de prezență sunt vizibile și pentru rezervările în curs sau viitoare, cu acțiunile dezactivate și ora de încheiere afișată. Cât timp lista este vizibilă, eligibilitatea este recitită periodic, fără a întrerupe completarea unui email sau o salvare. Panoul „Abateri clienți” include accesul „Marchează neprezentare” către lista rezervărilor. Marcarea „Nu s-a prezentat” folosește același contor comun și același `booking_attendance_client` din Make; nu sunt necesare un alt worker sau un webhook nou.

Testele `legacy-attendance.test.cjs` și testul de browser extins verifică identificarea, păstrarea rezervării originale, trimiterea unui singur eveniment, lipsa confirmărilor duplicate, corectările, permisiunile și protejarea limitelor de rezervare. Instalarea nu marchează automat rezervări istorice.
