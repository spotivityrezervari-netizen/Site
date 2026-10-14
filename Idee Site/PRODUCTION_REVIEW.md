# Verificare pentru producție — actualizare 14 octombrie 2026

Revizuire a codului, migrărilor SQL, configurației Supabase reale și publicării GitHub Pages. Corecțiile tehnice sunt implementate; lansarea publică finală mai necesită email, datele firmei și o soluție verificată de backup. Datele firmei și SMTP au fost amânate explicit de proprietar. Parolele noi păstrează minimum **6 caractere**, conform cererii sale.

Site: https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/

Admin: https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/admin.html

## Baze sportive și anulări — 14 octombrie 2026

Migrările [006](supabase/006_sports_bases.sql) și [007](supabase/007_completed_booking_cancellation.sql) sunt aplicate în proiectul Rendez-Vous. Au fost probate întâi în PostgreSQL izolat și într-o tranzacție live închisă cu rollback. **Nu trebuie rulat manual SQL pentru această actualizare.** Registrul instalat este **1, 3, 4, 5, 6, 7**, iar cele nouă tabele publice gestionate au RLS activ.

Proprietarul a cerut două baze cu câte două terenuri. Gruparea inițială păstrează orașele existente: **Baza A / Reghin: Exemplu, Exemplu2**; **Baza B / Târgu Mureș: Exemplu3, Exemplu4**. Bernabeu rămâne neasociat. Numele, descrierile și grupările se modifică din **Admin → Baze sportive**. Descrierile inițiale sunt goale. Nu s-au inventat detalii comerciale și nu s-au acordat automat permisiuni suplimentare administratorilor obișnuiți.

Butonul din navigarea publică deschide bazele pentru orașul selectat. Pagina bazei arată descrierea, terenurile și distribuirea prin link; deschiderea unui teren folosește formularul de rezervare existent și reverifică terenul prin API. Linkul partajat conține numai UUID-ul bazei, fără parametri/tokenuri Auth. Pictogramele mici de lângă titlurile sporturilor au fost eliminate; cele realiste se păstrează în admin la sportul corespunzător.

Superadminul poate crea baze, asocia/dezasocia terenuri existente și selecta baza la crearea unui teren nou. Funcția de salvare este `SECURITY INVOKER`: RLS și trigger-ele se aplică în continuare, iar metadatele, terenurile și permisiunile se salvează atomic. Adminul obișnuit poate modifica doar descrierea bazelor pentru care primește explicit permisiune. Acest acces nu extinde accesul la alte terenuri, rezervări, clienți, chat sau fotografii.

Conform cererii noi, o rezervare **finalizată nu mai poate fi anulată**, inclusiv prin API, pentru client, admin și superadmin. Limita este `starts_at + 1 oră`; rezervările viitoare și în desfășurare rămân anulabile potrivit accesului existent. Migrarea folosește valoarea veche din rând, prevenind ocolirea prin modificarea simultană a orei. Istoricul păstrează rezervarea. Mentenanța SQL de încredere fără identitate Auth își păstrează drepturile.

Verificarea live înainte/după aplicare a confirmat aceleași **8 conturi Auth, 5 profile, 2 admini, 5 terenuri, 57 rezervări, 24 mesaje și 25 sloturi**. Toate funcțiile private anterioare, definițiile/stările trigger-elor existente și politicile anterioare au fost păstrate. Sunt adăugate numai relațiile și protecțiile noi. Webhook-urile existente la momentul aplicării nu au fost rescrise.

Testele SQL noi au trecut: **32 + 32** pentru baze și **29 + 29** pentru anulările finalizate, cu ID-uri UUID și numerice. Acoperă retragerea permisiunilor, scrieri neautorizate, atomicitate, ora exactă de încheiere, tranzacții lungi și repetarea migrărilor. Recuperarea parolei/pozele au trecut **6 verificări**; limita parolei rămâne **6 caractere**. Testele autentificate sunt izolate; nu creează conturi, rezervări sau emailuri reale.

Au trecut integral **76 de verificări browser** cu SDK real și PostgreSQL izolat, inclusiv crearea bazei, adăugarea unui teren direct în bază, editarea autorizată, retragerea accesului, curățarea la logout, partajarea fără tokenuri și deschiderea rezervării existente. Sunt **204 verificări pentru actualizarea curentă** (122 SQL, 76 browser, 6 recuperare/poze). Verificările folosesc Chromium la **320, 390, 768 și 1440 px**; Safari/DuckDuckGo pe iPhone fizic nu au fost testate aici. A fost corectată și inițializarea dublă a canalului Realtime din admin, detectată în integrare.

Smoke test-ul local cu citiri reale a trecut pentru noul director public, descrieri și terenurile asociate, imagini, cele patru sporturi și autentificare. Scriptul refuză toate scrierile. Publicarea se verifică după push prin compararea fișierelor servite cu Git și un nou smoke test public.

## Actualizare vizuală și Supabase — 13 octombrie 2026

Pagina principală a fost refăcută după captura de referință: secțiuni mari pentru Fotbal, Baschet, Tenis și Volei, sigla `avatar2`, navigare pe desktop, selector de oraș și meniu pe tot ecranul pe telefon. Pictogramele sunt fișierele `fotbalrealist`, `baschetrealist`, `tenisrealist`, `voleirealist`; fundalurile sunt `RealistFotbal`, `RealisBaschet`, `RealistTenis`, `RealistVolei`. Accesul direct la apple.com a fost refuzat de rețeaua mediului; captura proprietarului a fost referința vizuală.

[005_sport_appearance.sql](supabase/005_sport_appearance.sql) a fost aplicată în Rendez-Vous după 36 de verificări SQL izolate și o probă live cu rollback. `public.site_sporturi` are patru rânduri de configurație publică; numai superadminul poate scrie prin API. Pagina și pictogramele admin citesc configurația prin SDK; valorile locale sunt fallback dacă serviciul este indisponibil. O probă izolată schimbă efectiv configurația și verifică noile imagini în pagină și în dialog, pentru a demonstra integrarea cu baza de date.

După aplicare: migrări **1, 3, 4, 5**, RLS pe toate cele șapte tabele gestionate, patru politici pentru noul tabel. Numerele înainte/după sunt identice: **8 conturi Auth, 5 profile, 2 admini, 5 terenuri, 48 rezervări, 22 mesaje, 24 sloturi**. Definițiile/stările trigger-elor, funcțiile private și politicile anterioare sunt identice. SQL-ul modifică doar configurația vizuală; nu este necesară rularea manuală a vreunui fișier pentru această actualizare.

## Corecții implementate

- Favicon admin: `assets/imagini/avatar2.png`, cu versiune în URL pentru cache.
- Recuperare: o singură fereastră bazată pe evenimentul validat de SDK; capturarea evenimentului înainte de încărcarea app.js; închiderea ferestrei și mesaje pentru link expirat. Un parametru `type=recovery` nu autorizează schimbarea parolei unei sesiuni existente. Cererea de schimbare folosește un client Auth separat, în memorie, legat de utilizatorul recuperării.
- Chat client: trimiterea păstrează utilizatorul și terenul de la click; schimbarea conversației/deconectarea în timpul verificării oprește trimiterea. Datele private din chat sunt curățate la schimbarea contului/deconectare.
- Admin: orașul editat se salvează; la deconectare/schimbarea utilizatorului se șterg setările, programul și mesajele afișate. Răspunsurile vechi nu repopulează aceste ecrane.
- Formulare publice: distanțe între câmpuri păstrate și după schimbarea tabului; X este integrat în antet. Căutarea după nume respectă filtrele, literele mari/mici și diacriticele.
- Telefon/admin: carduri și controale compacte, texte lungi încadrate, pictograme PNG pentru sporturi și etichete fără emojiuri decorative. Numai superadminul navighează prin orașe; adminul obișnuit deschide terenurile alocate direct.
- Blur: pagina din spatele dialogului este estompată direct, cu strat de acoperire până la margini. Selectorul global de oraș are lățime limitată pentru a nu suprapune contul/limba.
- Pozele absente/nevalide folosesc o imagine locală validă în același card și aceleași proporții.
- SDK Supabase fixat la versiunea `2.117.3`, cu verificare SRI SHA-384 și CORS. Artefactul fixat a fost comparat cu cel servit anterior prin `@2`.
- Scriptul de smoke test păstrează subdirectorul GitHub Pages și verifică erorile fișierelor de pe originea configurată.
- Supabase Auth: redirecturile sunt exacte; wildcardul vechi pentru spotivity.ro a fost eliminat. Site URL păstrează `/Site/Idee%20Site/`.
- Migrarea [004_admin_scope_hardening.sql](supabase/004_admin_scope_hardening.sql): un admin obișnuit nu poate obține profilul unui client nealocat printr-o rezervare manuală cu email ghicit. Rezervarea manuală rămâne guest, fără UUID client; un client deja autorizat rămâne legat. Superadminul poate lega orice cont existent.
- Storage: un admin realocat nu poate modifica/șterge o poză proprie referită de un teren nealocat. Restricțiile anonime se aplică scrierilor, păstrând citirea publică.
- Superadminul poate anula o rezervare istorică al cărei teren a fost șters. Migrările vechi sunt oprite după aplicarea corecțiilor noi, pentru a evita regresia regulilor.

## Verificări automate

Testele folosesc PostgreSQL izolat și cereri Auth/API interceptate; nu creează clienți, rezervări sau emailuri reale.

| Suită | Rezultat | Ultima execuție |
| --- | --- | --- |
| `supabase/tests/rls.test.cjs` | 85 verificări UUID + 85 cu ID numeric | 12 octombrie |
| `supabase/tests/court-hours.test.cjs` | 21 verificări UUID + 21 cu ID numeric | 12 octombrie |
| `supabase/tests/admin-scope.test.cjs` | 20 verificări UUID + 20 cu ID numeric | 12 octombrie |
| `supabase/tests/sport-appearance.test.cjs` | 18 verificări UUID + 18 cu ID numeric | 13 octombrie |
| `supabase/tests/browser.test.cjs` | 60 verificări cu SDK real + Chromium + PostgreSQL izolat | 13 octombrie |
| `supabase/tests/auth-recovery.test.cjs` | 6 verificări cu SDK real și Auth interceptat | 13 octombrie |

Total consemnat: **354 verificări automate**, plus sintaxa JS și diff-ul. Cele 252 de verificări ale protecțiilor existente au fost rulate pe 12 octombrie; după actualizarea vizuală din 13 octombrie au fost rulate integral **102 verificări**: 36 pentru noua migrare, 60 de integrare browser și 6 pentru recuperare/poze. Testele verifică limitele RLS, schimbarea contului în timpul recuperării, cursele din chat și XSS prin texte.

Interfața a fost verificată la **320, 390, 768 și 1440 px**: căutare cu filtre și diacritice, formularul de înregistrare, acoperirea blurului, antetul public fără suprapuneri, dashboardurile admin/superadmin, paginile orașelor, setările fiecărui teren, rezervarea manuală, programul, istoricul, chatul și alocarea angajaților. Probe cu nume lungi verifică încadrarea controalelor în chenare. Pictogramele sporturilor sunt decodate efectiv în browser; prețul mingii de 0 Lei rămâne 0. Verificările includ cele patru secțiuni, navigarea desktop, meniul mobil, păstrarea scrollului când se deschide/închide un dialog, configurarea imaginilor din baza de date și fallbackul la indisponibilitatea acesteia. **005 este deja aplicată; nu trebuie rulat SQL suplimentar.**

Smoke test local și publicat: pagina principală, cele patru sporturi, imagini, login, Escape, viewport mobil, pagina admin fără autentificare și citiri live Supabase. Cererile de scriere sunt blocate în smoke test. După push se compară fișierele publicate cu cele din Git, pentru a confirma versiunea servită efectiv.

## Auditul Supabase din 12 octombrie 2026

Proiectul autorizat: Rendez-Vous (`ndubcdwohqzgxpuiowye`). Migrarea 004 a fost aplicată prin Management API după o probă live închisă cu rollback. Nu trebuie rulată din nou manual.

- Migrări instalate: **1, 3, 4**. RLS activ pe `clienti`, `users_admin`, `terenuri`, `rezervari`, `mesaje_chat`, `rezervari_disponibilitate`.
- REST anonim: terenuri/disponibilitate HTTP 200; profile, roluri, rezervări private și chat refuzate cu `42501`.
- Probe SQL native cu roluri `anon` și `authenticated`, închise cu rollback: clientul vede numai datele proprii; adminul obișnuit vede propriul rol și datele autorizate ale terenurilor alocate.
- Schema `spotivity_private` nu este expusă în Data API; vizitatorii nu au acces la ea. Singurul helper RPC public al aplicației, `is_admin`, rulează ca invoker, fără ocolirea RLS.
- Nu există sloturi active duplicate, date nevalide, profile/roluri cu UUID fără Auth sau neconcordanțe între rezervări active și proiecția de disponibilitate.
- Bucketul `poze_terenuri` este public: maximum 5 MiB, numai JPEG/PNG/WebP/AVIF/GIF. Obiectele legacy fără prefix UUID se gestionează de superadmin.
- Realtime include rezervări, chat și proiecția disponibilității; citirea datelor private rămâne protejată de RLS.
- Înainte/după 004: **8 conturi Auth, 5 profile, 2 admini, 5 terenuri, 47 rezervări, 22 mesaje și 23 sloturi**. Definițiile și stările trigger-elor, inclusiv webhook-urile, au rămas identice.

Inventarul a identificat **33 rezervări istorice fără teren curent**, dintre care niciuna activă neîncheiată, și **3 conturi Auth vechi fără profil**. Nu au fost șterse/reasociate automat. Aceste conturi trebuie revizuite în Dashboard dacă vor fi folosite ca utilizatori de client; înregistrările noi își creează profilul prin trigger.

## Pași rămași pentru lansarea finală

1. **Email Auth:** în Supabase → Authentication → SMTP Settings, configurează un furnizor cu domeniu expeditor verificat. Testează efectiv confirmarea și recuperarea pe adrese proprii de test. Abia după livrare verificată activează Confirm email în setările Email, dacă dorești verificarea adreselor. În prezent confirmarea este automată, SMTP propriu lipsește, iar limita emailului builtin este 2/oră; livrarea publică nu a fost validată.
2. **Date și documente publice:** înlocuiește Numele SRL, CUI/Registrul Comerțului/adresa/telefonul demonstrative din `index.html` și textele traduse din `js/app.js`. Înlocuiește linkurile `#` către termeni/confidențialitate/cookies cu documentele reale. Datele nu se inventează.
3. **Backup/restaurare:** API-ul de backup a returnat `backups: []`, PITR dezactivat. Configurează o soluție potrivită planului și verifică restaurarea într-un proiect separat; include și fișierele Storage. Copiile private de metadate din acest mediu nu reprezintă un backup complet al proiectului.
4. **Conturi și date finale:** revizuiește cele 3 conturi vechi fără profil și terenurile/prețurile/programele de test înainte de deschidere publică. Păstrează istoricul; modificările de date comerciale se fac cu valorile reale ale proprietarului.
5. **Dispozitive reale:** probele de browser au folosit Chromium desktop și viewporturi mobile. Safari/DuckDuckGo pe iPhone real și livrarea Realtime între dispozitive reale nu au fost testate aici. Verifică un cont client și un admin proprii, inclusiv rezervare/anulare/chat, după configurarea emailului.

Security Advisor nu a raportat erori de nivel ERROR. A raportat `pg_net` instalat în public (extensie nerelocabilă, folosită de webhook-uri), protecția parolelor compromise dezactivată și lipsa politicilor pe tabelul privat al migrărilor. Tabelul privat refuză accesul clienților intenționat; extensia/webhook-urile nu au fost dezinstalate pentru a elimina cosmeticește avertizarea. GitHub Pages servește HTTPS/HSTS; nu au fost observate headere CSP sau X-Frame-Options. Protecția contra parolelor compromise, MFA admin și headere HTTP suplimentare rămân îmbunătățiri separate.

Aceste rezultate verifică scenariile și configurația descrise, fără a constitui o garanție pentru orice atac sau integrare externă. Emailurile/webhook-urile reale de rezervare și plățile nu au fost exercitate; site-ul nu conține implementare de plăți/rambursări.

## Reproducerea verificărilor în mediul cloud

Din folderul `Idee Site`, pornește `PORT=8010 bash scripts/start-site.sh`. Dependințele de test sunt în mediul cloud, nu se publică împreună cu site-ul.

```bash
NODE_PATH=/workspace/shared/spotivity-rls-validation/node_modules node supabase/tests/rls.test.cjs
NODE_PATH=/workspace/shared/spotivity-rls-validation/node_modules node supabase/tests/court-hours.test.cjs
NODE_PATH=/workspace/shared/spotivity-rls-validation/node_modules node supabase/tests/admin-scope.test.cjs
NODE_PATH=/workspace/shared/spotivity-rls-validation/node_modules node supabase/tests/sport-appearance.test.cjs
```

Repetă fiecare suită SQL cu `SPOTIVITY_TEST_INTEGER_IDS=1`. Pentru cele două suite de browser adaugă la `NODE_PATH` runtime-ul Playwright din mediul curent și setează `SITE_BASE_URL=http://127.0.0.1:8010/`. Păstrează verificarea TLS activă; folosește mecanismul de acces NSS al mediului dacă Chromium nu poate citi certificatele.

`SITE_BASE_URL=https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/ node scripts/smoke-site.cjs` verifică publicarea fără scrieri. Nu rula `tests/schema.sql` sau fișierele de test în SQL Editor-ul proiectului real. Pentru un alt proiect, aplică 001 → 003 → 004 → 005 → 006 → 007 după backup/inventar; 002 sunt exemple de roluri. **Nu reinstala 001/003 în Rendez-Vous.**
