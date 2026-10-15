# Instalarea protecțiilor Supabase și a rolurilor Spotivity

**Actualizare 15 octombrie 2026:** în Rendez-Vous sunt deja aplicate migrările **1, 3, 4, 5, 6, 7, 8, 9**, inclusiv profilul editabil, fotografiile bazelor sportive și refuzarea anulării rezervărilor finalizate. Nu trebuie să copiezi sau să rulezi din nou SQL pentru actualizarea curentă. Pașii de instalare de mai jos sunt pentru proiecte noi; istoricul datat descrie aplicările anterioare. Gestionează bazele din **Admin → Baze sportive**.

Acest pachet conține migrarea bazei de date și frontend-ul compatibil. Pregătirea fișierelor în GitHub nu execută automat SQL-ul în Supabase. Instrucțiunile de mai jos permit aplicarea din Dashboard; accesul administrativ configurat separat permite și aplicarea asistată prin Management API. Testele automate folosesc date fictive într-un PostgreSQL izolat.

Pe **10 octombrie 2026**, migrarea completă a fost aplicată în proiectul autorizat **Rendez-Vous**, referința `ndubcdwohqzgxpuiowye`, prin Management API. Au fost păstrate conturile Auth și datele existente; alocarea JSONB a superadminului a fost convertită la text și legată de UUID-ul Auth. Înainte de aplicare au trecut reproducerea izolată a structurii/datelor reale și o probă pe proiect închisă cu rollback. Copiile private ale datelor tabelelor aplicației și ale metadatelor nu sunt în Git și nu reprezintă un backup complet Supabase; fișierele Storage nu au fost modificate.

Verificările după aplicare au confirmat RLS pe cele șase tabele gestionate, refuzarea citirii anonime a datelor private, accesul propriu pentru cele patru conturi de client, accesul superadminului și accesul limitat al unui admin alocat. Proba pentru adminul alocat s-a închis cu rollback și nu a schimbat rolul existent. Au rămas **4 profile, 1 superadmin, 5 terenuri, 43 rezervări, 12 mesaje și 8 obiecte Storage**; conturile Auth și definițiile/stările webhook-urilor originale au rămas neschimbate. Citirile publice ale terenurilor/disponibilității și încărcarea imaginilor din Supabase au trecut și în browserul local.

Site-ul confirmat pe 12 octombrie 2026 este [GitHub Pages](https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/); panoul este [admin.html](https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/admin.html). Frontend-ul compatibil și SQL-ul se află în `main`. `netlify.toml` păstrează configurația găzduirii Netlify folosite anterior; nu este necesar pentru GitHub Pages.

**Site URL** și redirectul exact către folderul GitHub Pages au fost configurate în Supabase pe 12 octombrie; adresele Netlify și spotivity.ro permise anterior au fost păstrate. Înregistrarea și recuperarea parolei trimit adresa folderului paginii, inclusiv `/Site/Idee%20Site/`. Înregistrarea este activă, emailurile sunt confirmate automat, iar SMTP personalizat nu este configurat. Aceste opțiuni au fost păstrate.

## Interfața și imaginile sporturilor: 13 octombrie 2026

Pagina principală folosește secțiuni mari pentru fiecare sport, navigare pe desktop și meniu pe tot ecranul pe telefon. Avatarul `avatar2.png` este sigla din antet. Orașele se aleg în bara de sus; căutarea după numele terenului și filtrele de dată/oră sunt în fereastra sportului. Butoanele din navigare și meniu deschid aceleași formulare de rezervare și profil.

[005_sport_appearance.sql](005_sport_appearance.sql) este **deja aplicată în Rendez-Vous** prin Management API, după 36 de verificări izolate și o probă live cu rollback. **Nu trebuie să copiezi/rulezi SQL pentru această actualizare.** Tabelul `public.site_sporturi` conține numai configurația vizuală:

| Sport | Pictogramă | Fundal |
| --- | --- | --- |
| Fotbal | `fotbalrealist.png` | `RealistFotbal.png` |
| Baschet | `baschetrealist.png` | `RealisBaschet.png` |
| Tenis | `tenisrealist.png` | `RealistTenis.png` |
| Volei | `voleirealist.png` | `RealistVolei.png` |

Căile sunt relative la `assets/imagini/`. Numele `RealisBaschet.png` corespunde exact fișierului încărcat în GitHub. `sport` identifică una dintre cele patru categorii, `icona_url` și `fundal_url` stabilesc imaginile, iar `ordine` este între 1 și 4. Vizitatorii și conturile autentificate pot citi configurația; numai superadminul poate scrie prin API. Proprietarul proiectului poate edita valorile și din Table Editor/SQL Editor. Sunt acceptate imagini locale și URL-uri HTTPS valide. La indisponibilitatea configurației, site-ul folosește imaginile locale incluse.

Verificarea înainte/după aplicarea 005 a confirmat aceleași **8 conturi Auth, 5 profile, 2 admini, 5 terenuri, 48 rezervări, 22 mesaje și 24 sloturi**, precum și definiții/stări identice pentru trigger-ele, funcțiile private și politicile existente. Migrările instalate sunt acum **1, 3, 4 și 5**. Pozele specifice terenurilor sunt în continuare în `terenuri.poza`; noul tabel configurează imaginile categoriilor de sport.

## Programul terenurilor: actualizarea din 12 octombrie 2026

[003_court_hours.sql](003_court_hours.sql) adaugă `terenuri.ore_rezervabile` și verificarea programului la rezervare. Terenurile existente păstrează implicit **12:00–22:00**. Fiecare teren poate avea orice selecție de ore de început între **09:00 și 22:00**; o rezervare începută la 22:00 se termină la 23:00. Programul este comun tuturor zilelor, iar blocajele din **Program & Disponibilitate** permit excepții pentru o anumită zi.

Pentru a modifica programul:

1. Deschide [panoul admin](https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/admin.html) și autentifică-te.
2. Dacă ești superadmin, deschide **Setări [oraș]**, apoi terenul. Ca admin obișnuit, deschide direct **Setări [teren]** din meniu; sunt afișate doar terenurile alocate.
3. În **Ore rezervabile**, bifează orele de început dorite și apasă **Salvează**. De exemplu, bifează 09:00–21:00 dacă terenul trebuie să închidă la 22:00.
4. Deschide terenul din pagina publică: apar numai orele bifate. Filtrul de oră folosește programele terenurilor afișate; rezervarea manuală și blocarea unei zile respectă același program.

Fără nicio bifă nu se acceptă rezervări noi. Rezervările existente nu sunt șterse sau anulate automat când programul se schimbă; cele din afara programului nou rămân în tabelul admin, cu anulare și chat. Clienții își pot anula rezervările oricând. Adminii obișnuiți pot schimba numai terenurile alocate, iar superadminul poate modifica programul tuturor terenurilor. Supabase refuză o rezervare nouă la o oră nebifată, inclusiv dintr-o pagină rămasă deschisă înaintea modificării. Pagina citește programul la deschiderea terenului și la actualizarea periodică a disponibilității. Confirmarea păstrează datele selectate la click și se oprește dacă utilizatorul schimbă ziua sau terenul în timpul verificării.

Pentru alt proiect care are deja migrarea 001, copiază întregul **Raw** din `003_court_hours.sql` în **Supabase → SQL Editor → New query**, rol `postgres`, apoi **Run**. În proiectul Rendez-Vous aplicarea asistată este consemnată mai jos; nu este necesar să rulezi din nou fișierele 000/001/002 sau să recreezi conturile. `001_security.sql` se oprește dacă 003 este deja instalată, pentru a evita restaurarea regulilor vechi.

Pe **12 octombrie 2026**, migrarea 003 a fost aplicată în **Rendez-Vous** prin Management API, după o probă completă închisă cu rollback. Verificarea imediată a confirmat migrațiile 1 și 3, noua coloană, RLS păstrat și definițiile/stările tuturor trigger-elor neschimbate. Numerele de conturi și înregistrări au rămas identice: **8 conturi Auth, 5 profile, 2 admini, 5 terenuri, 47 rezervări, 22 mesaje și 23 sloturi ocupate**. Migrarea nu a rescris rezervările și nu a schimbat webhookurile.

## Revizuirea pentru producție din 12 octombrie 2026

[004_admin_scope_hardening.sql](004_admin_scope_hardening.sql) este **deja aplicat** în proiectul Rendez-Vous. Verificarea live a confirmat migrațiile **1, 3 și 4**, RLS pe toate cele șase tabele și păstrarea datelor și a definițiilor/stărilor trigger-elor. **Nu rula din nou 001 sau 003 în acest proiect**: ar restaura reguli vechi; scripturile actuale opresc această operație.

004 împiedică un admin obișnuit să lege o rezervare manuală de un cont client neautorizat doar ghicindu-i emailul. Rezervarea rămâne manuală, fără UUID client, până există o relație autorizată; superadminul poate lega orice cont existent. După realocare, adminul nu poate modifica/șterge o poză proprie încă folosită de un teren nealocat. Pozele fără prefix UUID, încărcate înaintea protecțiilor, se gestionează de superadmin. Politicile anonime Storage restricționează scrierile separat, păstrând citirea publică. Superadminul poate anula și o rezervare istorică al cărei teren a fost șters.

Adresele de redirect Auth sunt exacte; wildcardul vechi pentru spotivity.ro a fost eliminat. La cererea proprietarului, parola nouă are în continuare minimum **6 caractere**. Confirmarea automată și absența SMTP au fost păstrate; configurarea emailului și datele firmei sunt amânate de proprietar. Raportul de verificare și pașii rămași sunt în [PRODUCTION_REVIEW.md](../PRODUCTION_REVIEW.md).

Pentru **alt proiect**, ordinea migrărilor este **001 → 003 → 004 → 005 → 006 → 007 → 008 → 009** după inventar/backup și verificarea datelor. 002 conține numai exemple de roluri pentru conturi Auth existente și confirmate. Fișierele `tests/` se rulează exclusiv în baza izolată. Instrucțiunile istorice de mai jos pentru reinstalarea 001 se aplică numai proiectelor fără migrări ulterioare.

## Căutare și afișare pe telefon

În pagina publică, deschide un sport și folosește **Caută terenul**. Numele se citesc din `terenuri`; căutarea acceptă litere mari/mici și text fără diacritice și se combină cu orașul, data și ora selectate. Ștergerea textului restabilește lista, iar deschiderea unui alt sport resetează căutarea.

Panoul admin afișează **Setări [oraș] → terenuri** numai superadminului. Adminii obișnuiți deschid direct **Setări [teren]** pentru alocările lor din `users_admin`. Pictogramele sporturilor se citesc din configurația `site_sporturi`, comună cu pagina principală; etichetele nu mai conțin emojiuri decorative. Formularele, chatul, istoricul și programul folosesc dimensiuni adaptate telefonului, cu scroll în chenar când conținutul este lung.

Aceste modificări folosesc coloanele și politicile deja instalate, inclusiv 005 aplicată pe 13 octombrie. **Nu necesită SQL suplimentar sau rerularea 001/003/004/005 în Rendez-Vous.** Salvarea setărilor rămâne protejată de RLS. Prețul mingii egal cu zero se păstrează; doar valoarea lipsă folosește implicit 15.

## 1. Ce va putea face fiecare rol

| Rol | Date și operații permise |
| --- | --- |
| Vizitator | Terenuri active, imagini publice și ore ocupate, fără datele clienților. |
| Client autentificat | Profilul, rezervările și chat-ul propriu. Poate modifica numele/telefonul și anula oricând o rezervare proprie activă, inclusiv după începerea sau încheierea ei. |
| Admin | Rezervări, chat și setări pentru terenurile alocate; datele clienților care au rezervări la acele terenuri. Nu poate acorda roluri sau crea/șterge terenuri. |
| Superadmin | Toate datele aplicației: terenuri, setări, rezervări, profiluri, chat, imagini și roluri admin. Poate redenumi terenuri, cu actualizarea referințelor. |

Anularea nu mai are limita de 6 ore. Clientul poate schimba doar starea propriei rezervări din `activa` în `anulata`, fără să rescrie terenul, prețul, data sau proprietarul. Aceeași regulă se aplică în interfață și în baza de date. O rezervare anulată rămâne în istoric; dacă era pentru o oră viitoare, ora devine disponibilă. Pachetul nu execută rambursări și nu conține un sistem de plăți.

Superadminul este un rol al aplicației, nu proprietarul proiectului Supabase. Nu primește parolele utilizatorilor, acces la SQL arbitrar, facturare sau dreptul de a ignora constrângerile bazei de date. Conturile și parolele adminilor se creează în **Authentication → Users**; panoul site-ului alocă rolurile unor conturi existente.

## 2. Fișierele pe care le folosești

Deschide ramura `main` în GitHub, apoi folderul `Idee Site/supabase`:

- [000_preflight.sql](000_preflight.sql): inventar fără modificări, pentru verificarea bazei existente.
- [000_rpc_review.sql](000_rpc_review.sql): diagnostic fără modificări dacă migrarea se oprește pentru funcții publice `SECURITY DEFINER`.
- [001_security.sql](001_security.sql): migrarea completă, inclusiv RLS, funcții, trigger-e, Storage și disponibilitate.
- [002_admin_examples.sql](002_admin_examples.sql): exemple pentru primul superadmin și adminii alocați.
- [003_court_hours.sql](003_court_hours.sql): program configurabil pe teren, după migrarea 001.
- [004_admin_scope_hardening.sql](004_admin_scope_hardening.sql): limite suplimentare pentru admini și imagini, după 003.

Pe pagina unui fișier din GitHub, apasă **Raw** și copiază întregul conținut. Nu copia marcajele Markdown sau numerele de linie. `tests/schema.sql` și celelalte fișiere din `tests/` sunt exclusiv pentru baza izolată a testelor: **nu le rula în Supabase**.

## 3. Pregătirea: backup și proiect de test

1. Identifică proiectul Supabase folosit de site. URL-ul din `Idee Site/js/db.js` trebuie să corespundă proiectului pe care îl vei migra. Verifică numele proiectului în Dashboard înainte de fiecare rulare SQL.
2. Păstrează un backup al bazei actuale și al versiunii actuale a site-ului. Folosește opțiunile de backup/restaurare disponibile pentru planul tău Supabase sau un export prin instrumentele oficiale. Verifică ce acoperă backup-ul: fișierele din Storage trebuie protejate separat dacă backup-ul bazei nu include conținutul lor. Nu presupune că descărcarea tabelelor publice salvează și Auth, politicile și trigger-ele.
3. Creează un proiect Supabase separat pentru test și copiază în el structura necesară și date de test reprezentative. Păstrează datele personale numai în medii la care ai controlul accesului. Un proiect nou nu copiază automat utilizatorii Auth, obiectele Storage sau publicațiile Realtime din proiectul real.
4. Folosește o copie separată a frontend-ului pentru test. Din setările API ale proiectului de test, ia URL-ul și cheia publică `anon`/publishable și setează-le în `js/db.js` din acea copie. Nu schimba accidental conexiunea site-ului de producție. O previzualizare de hosting folosește tot proiectul real dacă nu îi schimbi această configurație. Nu introduce o cheie `service_role`, secretă sau parolă de bază de date în frontend.
5. Planifică activarea în producție într-o fereastră de mentenanță. După migrare, frontend-ul vechi poate primi refuzuri de acces: SQL-ul și frontend-ul nou trebuie activate împreună, iar paginile deja deschise trebuie reîncărcate.

## 4. Verifică baza existentă cu `000_preflight.sql`

În proiectul de test, deschide **SQL Editor → New query**, lipește tot fișierul `000_preflight.sql` și apasă **Run**. Folosește rolul administrativ `postgres` dacă interfața oferă un selector de rol. Acest script afișează inventarul; nu repară automat problemele și un rezultat fără eroare nu reprezintă o certificare a securității.

Verifică înainte de migrare:

- Coloanele, tipurile, constrângerile și indexurile celor cinci tabele. Schema testată provine din documentul furnizat și din frontend; constrângerile suplimentare ale proiectului tău pot necesita adaptare.
- Rândurile existente din `users_admin`. Păstrează numai rolurile acordate de tine. Migrarea le leagă de utilizatorii Auth existenți și confirmați; nu poate demonstra că un rol introdus într-o bază anterior deschisă a fost legitim. Creează în Auth conturile adminilor lipsă înainte de aplicare.
- Emailuri sau nume de teren duplicate, rezervări active pentru același teren/data/ora și date nevalide. Migrarea se oprește pentru aceste cazuri; nu șterge automat înregistrări. Numele terenurilor nu pot conține virgule, deoarece alocările folosesc o listă separată prin virgule.
- Anul rezervărilor vechi. Codul vechi salva date ca `Lun, 05.01`, fără an, deși documentul descria `YYYY-MM-DD`. Migrarea deduce anul din `timestamp_start`/`created_at`, inclusiv trecerea decembrie → ianuarie. Verifică rezultatul în copia de test și corectează ambiguitățile înainte de producție. Datele noi și `starts_at` folosesc `Europe/Bucharest`.
- Trigger-ele Auth care creează deja profile. Două trigger-e care inserează același profil pot bloca înregistrarea. Identifică scopul lor înainte de a înlocui logica duplicată. Profilele istorice fără cont Auth asociat rămân inaccesibile clienților și pot necesita reconciliere înainte de o nouă înregistrare cu același email.
- Funcțiile RPC publice `SECURITY DEFINER` și view-urile/materialized view-urile expuse. Migrarea refuză funcții apelabile sau view-uri care pot ocoli RLS pe datele private. Analizează fiecare caz separat; nu elimina verificarea pentru a forța aplicarea. Un view poate necesita `security_invoker = true` și grant-uri potrivite; un materialized view necesită un design separat.

Dacă primești o eroare pe care nu o înțelegi, păstrează mesajul exact și verifică problema în proiectul de test înainte de a modifica proiectul real.

### Eroarea „Review exposed public SECURITY DEFINER RPCs”

Mesajul arată că există funcții publice care rulează cu drepturile proprietarului și pot fi apelate de vizitatori sau utilizatori autentificați; nu demonstrează singur că fiecare funcție este nesigură. Dacă această verificare oprește migrarea, nicio modificare din tranzacția ei nu se aplică.

Definiția veche a `public.is_admin()` trimisă în CSV a fost verificată: testa apartenența la `users_admin` prin emailul din JWT. Versiunea actualizată a `001_security.sql` recunoaște strict această definiție și o convertește în aceeași tranzacție la `SECURITY INVOKER`, cu `search_path` fix și verificare prin `auth.uid()`/`user_id`. Păstrează funcția și referințele politicilor existente. Pentru vizitatori returnează `false` fără să citească tabelul privat; pentru utilizatorii autentificați respectă RLS. Nu este necesară ștergerea funcției sau retragerea separată a permisiunilor.

**Pentru acest caz:** deschide versiunea actualizată a `001_security.sql` în GitHub, apasă **Raw**, înlocuiește întregul conținut al interogării vechi din SQL Editor și rulează întregul script după backup/verificarea în test. Conversia funcției și migrarea se confirmă împreună; o eroare ulterioară le anulează pe ambele. Orice altă definiție `SECURITY DEFINER` sau alt RPC rămâne blocat pentru revizuire.

Pentru alte funcții care declanșează această eroare:

1. Deschide `000_rpc_review.sql` în GitHub, apasă **Raw** și copiază tot codul.
2. În **SQL Editor → New query**, rulează acest diagnostic separat ca `postgres`. Afișează doar funcțiile care declanșează blocajul, semnăturile lor exacte, permisiunile și codul SQL. Nu schimbă date sau permisiuni.
3. Verifică definițiile și utilizarea în site, politici, trigger-e și integrări. Păstrează acest rezultat pentru revizuire înainte de a decide ce acces retragi. Dacă o definiție conține chei sau parole, elimină-le din copia pe care o distribui.
4. Pentru o funcție identificată și confirmată ca nefolosită de clienții API, se poate retrage punctual dreptul `EXECUTE` de la `PUBLIC`, `anon` și `authenticated`, fără ștergerea funcției. Includerea `PUBLIC` contează deoarece permisiunea implicită poate fi moștenită. Funcțiile necesare trebuie adaptate după analizarea codului și a dependențelor, nu dezactivate în bloc.
5. Repetă diagnosticul după corecție. Dacă nu mai există funcții care declanșează această verificare, rulează din nou întregul `001_security.sql`; celelalte verificări ale migrării se aplică în continuare.

Nu elimina verificarea din migrare pentru a forța aplicarea. Dacă o interogare ulterioară afișează `25P02`/„current transaction is aborted”, rulează separat `ROLLBACK;`, apoi repetă diagnosticul; această comandă închide tranzacția eșuată.

### Eroarea „string_to_array(jsonb, unknown) does not exist”

Această eroare arată că `users_admin.terenuri` este JSONB în proiectul existent, în timp ce frontend-ul și regulile noi folosesc o listă text separată prin virgule. Versiunea actualizată a `001_security.sql` convertește automat coloanele JSON/JSONB la text în aceeași tranzacție cu migrarea:

- Un string JSON, de exemplu `"Bernabeu,Wimbledon"`, devine `Bernabeu,Wimbledon`.
- Un array de nume, de exemplu `["Bernabeu", "Wimbledon"]`, devine aceeași listă text. Elementele trebuie să fie stringuri fără virgule.
- Valorile `is_super` se păstrează, iar alocările se verifică față de terenurile existente. Obiectele, numerele, valorile booleene și array-urile cu elemente nevalide opresc întreaga migrare. O alocare goală nu este acceptată pentru un admin obișnuit.

Default-ul JSON este înlocuit cu textul gol; acesta nu acordă acces la terenuri. Politicile gestionate se înlocuiesc în aceeași tranzacție înainte de conversie, pentru a permite schimbarea tipului. Alte constrângeri sau dependențe incompatibile opresc migrarea și se revizuiesc separat, fără ștergere automată. La o eroare, conversia, datele și politicile revin la starea dinaintea rulării.

După backup și verificare în proiectul de test, ia **întregul `001_security.sql` actualizat** din GitHub → **Raw**, înlocuiește tot codul vechi din SQL Editor și apasă **Run**. Nu folosi doar un cast `terenuri::text`: un array JSON ar păstra parantezele și ghilimelele, schimbând interpretarea alocărilor.

### Acces Supabase pentru lucrul asistat în Codex

În mediul cloud al acestei conversații, accesul administrativ se configurează prin Management API:

1. În [Supabase Account → Access Tokens](https://supabase.com/dashboard/account/tokens), generează un token.
2. În setările securizate ale mediului Codex, introdu valoarea la secretul `SUPABASE_ACCESS_TOKEN`, permis numai pentru domeniul HTTPS `api.supabase.com`. Nu pune valoarea în chat, în GitHub sau în frontend.
3. Setează variabila nesensibilă `SUPABASE_PROJECT_REF` la referința proiectului corect. Proiectul folosit în `js/db.js` este `ndubcdwohqzgxpuiowye`.
4. Salvează și publică configurația mediului. Declararea secretului fără valoare nu oferă acces, iar salvarea configurației nu execută migrarea bazei.
5. După configurare, accesul și schema reală trebuie verificate înainte de aplicarea SQL-ului. Revocă tokenul din Supabase când lucrul administrativ s-a încheiat.

## 5. Configurează autentificarea

În Dashboard, denumirile paginilor pot varia puțin între versiunile Supabase:

1. În **Authentication → Sign In / Providers → Email**, păstrează autentificarea cu email/parolă. Proiectul existent confirmă automat emailurile. Pentru un proiect care cere confirmare prin email, configurează și verifică SMTP înainte de activarea **Confirm email**; apoi clientul trebuie să confirme adresa înainte de autentificare.
2. În **Authentication → URL Configuration**, setează **Site URL** la adresa HTTPS reală a site-ului: `https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/` pentru GitHub Pages actual. Păstrează subdirectorul și `/` la final. Dacă activezi ulterior un domeniu propriu, actualizează acest câmp la adresa publicată.
3. La **Redirect URLs**, adaugă adresele exacte folosite de site pentru confirmare și resetare. Adresa GitHub Pages actuală este deja permisă; `js/app.js` trimite folderul paginii cu `/` la final, inclusiv subdirectorul de găzduire. Pentru proiectul de test, configurează adresa frontend-ului de test în proiectul Supabase separat. Nu redirecționa utilizatorii de test către producție.
4. Verifică politica de parole, limitele de autentificare și livrarea mesajelor de confirmare/resetare. Pentru lansare, configurează serviciul de email/SMTP potrivit proiectului și testează efectiv livrarea, inclusiv folderul Spam.

Rolurile se citesc din `users_admin`, legat de UUID-ul Auth. Nu acorda privilegii prin `user_metadata.is_super`, `localStorage` sau un câmp trimis de browser. MFA necesită configurarea și verificarea unui flux separat; acest pachet nu implementează acel flux. Integrările Make.com/backend trebuie să folosească autentificare proprie cu privilegii potrivite.

## 6. Rulează migrarea completă

1. În **SQL Editor → New query**, copiază tot conținutul actual al `001_security.sql`.
2. Verifică din nou proiectul selectat și rulează ca `postgres`.
3. Așteaptă rezultatul. Scriptul conține propria tranzacție: dacă o verificare eșuează, modificările acelei rulări se anulează. Repară cauza raportată în proiectul de test, apoi rulează din nou întregul fișier.
4. După succes, verifică în **Table Editor** coloanele noi și tabelul `rezervari_disponibilitate`. Nu dezactiva RLS dacă o cerere a site-ului este refuzată; verifică identitatea, rolul, alocarea și versiunea frontend-ului.

Migrarea face automat următoarele:

- Activează RLS și înlocuiește politicile existente pentru tabelele aplicației; politici permisive vechi păstrate ar putea ocoli reguli noi.
- Leagă profilele și rolurile prin `user_id`, iar rezervările și chat-ul prin `client_user_id`, de `auth.users.id`. Retragerea rolului are efect în baza de date fără a aștepta emiterea unui JWT nou.
- Creează profilul la înregistrarea Auth, folosind numele/telefonul din metadata, fără a crea un rol admin. Sincronizează emailurile la schimbarea emailului Auth.
- Calculează prețul rezervărilor clientului din `terenuri` și `cu_minge`, verifică orele selectate pentru teren (după migrarea 003, între 09:00 și 22:00), minimum o oră în avans și următoarele 7 zile. Mingea se taxează pe primul rând al pachetului, ca în interfață. Adminii pot introduce rezervări manuale și blocaje fără cont client asociat.
- Previne două rezervări active pentru același teren/oră printr-un index unic și permite anularea unei rezervări proprii active; migrarea 007 blochează anularea după sfârșitul orei rezervate.
- Publică numai disponibilitatea: ID opac, teren, dată și oră. Emailul, profilul și prețul clientului nu sunt publicate pentru a afișa orele ocupate.
- Limitează chat-ul clientului la terenuri cu chat activ și o rezervare activă neîncheiată. Clienții și adminii obișnuiți pot marca mesajele primite drept citite, fără să le rescrie conținutul.
- Creează schema internă `spotivity_private`. Nu o adăuga la schemele expuse de Data API.
- Suspendă numai webhook-urile Supabase `AFTER UPDATE` ale rezervărilor în timpul conversiei interne, apoi restaurează exact obiectele și stările lor înainte de commit. Astfel, migrarea și reexecutarea ei nu trimit notificări de anulare pentru simple conversii de date. Webhook-urile de înregistrare, rezervare nouă și chat se păstrează.

### Dacă ai aplicat deja versiunea cu limita de 6 ore

Descarcă versiunea actualizată din ramura GitHub, păstrează un backup și verifică mai întâi în proiectul de test. Rulează **întregul `001_security.sql` actualizat** în SQL Editor, apoi publică frontend-ul actualizat. Rularea reușită se poate repeta: înlocuiește și funcția de validare a anulării, fără să ceară ștergerea tabelelor sau dezactivarea RLS. Scriptul reconstruiește disponibilitatea și politicile gestionate, deci folosește o fereastră de mentenanță și pentru actualizare. Nu trebuie să recreezi conturile Auth sau rolurile deja valide și nici să rulezi din nou exemplele de admin dacă alocările rămân aceleași.

Rulările ulterioare nu realocă istoricul unui utilizator șters unui cont nou cu același email. Dacă actualizezi doar SQL-ul, un frontend vechi poate continua să ascundă butonul de anulare; dacă actualizezi doar frontend-ul, regula veche din bază poate continua să refuze cererea.

## 7. Creează superadminul și adminii alocați

### Primul superadmin

1. În **Authentication → Users → Add user / Create new user**, creează un cont cu emailul tău și o parolă puternică, unică. Pentru contul administrativ creat de tine, folosește opțiunea de confirmare a emailului disponibilă în Dashboard sau finalizează confirmarea. Dacă există deja, folosește contul existent.
2. Deschide `002_admin_examples.sql`. Copiază în SQL Editor **numai primul bloc `insert ... on conflict ...`**, destinat superadminului.
3. Înlocuiește `inlocuieste-superadmin@example.invalid` cu emailul exact al contului Auth, scris cu litere mici. Poți înlocui și numele `Superadmin`. Păstrează `is_super = true` și `terenuri = 'ALL'`.
4. Rulează blocul, apoi execută interogarea de verificare din același fișier, cea care începe cu `select a.nume_admin`. Rândul trebuie să aibă UUID-ul contului Auth, `is_super = true` și `email_confirmed = true`.

Dacă `insert ... select` nu găsește un cont Auth confirmat cu emailul indicat, nu adaugă niciun rol; un mesaj de succes SQL fără rândul așteptat nu este suficient. Verifică emailul, proiectul și confirmarea contului. Primul superadmin se acordă din SQL Editor, deoarece un client sau un admin obișnuit nu poate crea acel rol.

### Un admin pentru terenurile alocate

1. Creează și confirmă contul în **Authentication → Users**, la fel ca mai sus.
2. Din `002_admin_examples.sql`, copiază **numai blocul pentru adminul obișnuit** în SQL Editor.
3. Înlocuiește emailul `.invalid`, numele `Admin terenuri` și `Numele exact al terenului`. Pentru două terenuri, valoarea poate fi `'Bernabeu,Wimbledon'`, dacă acestea sunt numele exacte din `terenuri.nume`. Păstrează `is_super = false`.
4. Rulează blocul și interogarea de verificare. Adminul trebuie să aibă `is_super = false`, email confirmat și lista terenurilor corectă.

După publicarea site-ului, superadminul se poate autentifica în `admin.html` și poate acorda roluri unor conturi Auth existente din panou. Interfața actuală adaugă roluri noi; pentru modificarea alocărilor unui rol existent folosește blocul SQL pentru admin, care actualizează alocarea prin `on conflict (user_id)`. Rulează doar blocul corespunzător: blocul pentru admin obișnuit poate transforma un superadmin existent în admin dacă folosești același email.

Pentru retragerea unui rol, ultimul exemplu comentat din `002_admin_examples.sql` șterge numai rândul din `users_admin`, folosind UUID-ul Auth. Nu șterge contul Auth pentru o simplă retragere de acces. Dacă ultimul superadmin își pierde rolul, poți folosi din nou primul bloc SQL ca proprietar al proiectului.

## 8. Storage și Realtime

Migrarea creează sau actualizează automat bucket-ul public **`poze_terenuri`**, cu imagini JPEG/PNG/WebP/AVIF/GIF de maximum **5 MB**. Nu trebuie să îl creezi separat. Imaginile publice pot fi văzute prin URL; acest lucru nu acordă drept de upload sau ștergere. Adminul scrie în folderul propriului UUID, iar superadminul poate gestiona toate imaginile. Politicile restrictive protejează scrierile chiar dacă există politici Storage generale vechi. Alte bucket-uri păstrează politicile lor existente.

În **Storage**, verifică existența bucket-ului și testează upload-ul din panoul admin. Când adaugi sau schimbi imaginea unui teren, `terenuri.poza` trebuie să conțină URL-ul public al imaginii sau calea locală validă utilizată de site. Migrarea nu mută automat fișierele locale în Storage.

Dacă publicația **`supabase_realtime`** există, migrarea adaugă automat `public.rezervari_disponibilitate`. În **Database → Publications / Realtime**, verifică participarea acestui tabel și a tabelelor `rezervari` și `mesaje_chat` folosite deja de aplicație. Migrarea nu creează o publicație lipsă și nu adaugă automat cele două abonamente originale dacă nu erau configurate. Activează-le în Dashboard dacă lipsesc, păstrând RLS.

Verifică disponibilitatea în două ferestre și chat-ul între client și admin. Nu permite citirea publică a `rezervari` sau `mesaje_chat` pentru a „repara” Realtime; disponibilitatea publică vine din tabelul separat, fără date personale.

## 9. Publică frontend-ul după SQL

1. Validează mai întâi proiectul Supabase de test și copia frontend-ului de test.
2. Pentru producție, repetă preflight-ul, backup-ul, migrarea și verificarea rolurilor în proiectul real.
3. Frontend-ul compatibil este deja în `main`. Pentru actualizări viitoare, compară ramura de lucru cu `main` și integrează modificările după ce baza reală este pregătită. Publicarea poate porni automat când actualizezi `main`, dacă hostingul urmărește acea ramură; verifică setarea hostingului înainte de integrare.
4. Publică toate fișierele compatibile împreună: `index.html`, `admin.html`, `js/app.js`, `js/admin.js`, `js/security.js`, `css/style.css` și `css/admin.css`. Dacă hostingul servește `Idee Site/`, păstrează acea rădăcină de publicare. Documentația și SQL-ul nu înlocuiesc fișierele frontend.
5. Verifică în `js/db.js` publicat URL-ul și cheia publică ale proiectului real. Invalidează cache-ul/CDN dacă există și reîncarcă pagina; paginile actualizate folosesc versiuni noi pentru fișierele JS.

Nu publica frontend-ul nou înainte de migrare: folosește coloane și tabelul de disponibilitate care lipsesc din vechea schemă. Revenirea la frontend-ul vechi nu anulează migrarea bazei; pentru o restaurare folosește un plan verificat și backup-ul corespunzător.

### Verificarea publicării în GitHub Pages

În repository-ul `spotivityrezervari-netizen/Site`, verifică **Settings → Pages** și ultimul deployment **github-pages** din **Actions** / **Deployments**. Publicarea trebuie să corespundă ultimului commit din `main`. Adresa paginii principale este `https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/`, iar adminul este în același folder, la `admin.html`.

Versiunea actuală încarcă `css/style.css?v=43`, `js/security.js?v=2`, `js/app.js?v=25`, `css/admin.css?v=3`, `js/admin.js?v=22`, `css/home.css?v=2`, `js/home.js?v=2`, `js/baze.js?v=1` și `js/admin-baze.js?v=1`. Reîncarcă pagina după terminarea deployment-ului. Actualizarea ramurii GitHub nu demonstrează singură terminarea publicării; testele izolate nu înlocuiesc verificarea site-ului publicat.

## 10. Verificări înainte de lansare

Folosește conturi distincte și ferestre/sesiuni separate pentru client, admin alocat și superadmin. În Dashboard, contul proprietarului poate vedea toate datele și nu reprezintă un test al RLS aplicat clientului.

- **Vizitator:** vede terenurile active și orele ocupate; nu poate vedea profilele, emailurile, rezervările private, chat-ul sau rolurile.
- **Doi clienți:** înregistrare cu confirmare, autentificare, refresh și logout; fiecare vede numai propriile date. O încercare de a rezerva simultan aceeași oră lasă cel mult o rezervare activă.
- **Anulare:** testează o rezervare proprie cu mai mult de 6 ore înainte, una cu mai puțin de 6 ore, una începută și una încheiată, folosind date de test. Cele viitoare și cele în desfășurare se pot anula; după migrarea 007, cele încheiate nu se mai pot anula; alt client nu le poate anula. Pentru rezervările încheiate, deschide și istoricul. Verifică starea `anulata` și actualizarea disponibilității pentru orele viitoare.
- **Admin alocat:** vede și modifică numai terenurile lui; gestionează rezervări/chat și upload pentru acestea. Nu poate acorda roluri, crea/șterge terenuri sau gestiona un teren nealocat.
- **Superadmin:** vede toate terenurile, poate modifica datele și alocările; după retragerea rolului unui admin, accesul acelui cont este refuzat de bază.
- **Chat și imagini:** verifică ambele sensuri ale chat-ului, marcarea mesajelor citite și upload-ul cu fișier permis; un client nu trebuie să poată scrie imagini.
- **Confirmare și resetare parolă:** emailurile ajung la utilizator și linkurile duc la adresa corectă a site-ului.

Ascunderea unui buton nu este suficientă: verifică și că cererile nepermise sunt refuzate de API. Fă încercările cu date și conturi de test, fără a modifica rezervările reale ale clienților.

## Verificări automate pentru dezvoltare

Din `Idee Site`, cu serverul local pornit și PGlite/Playwright instalate în afara proiectului:

```bash
node supabase/tests/rls.test.cjs
SPOTIVITY_TEST_INTEGER_IDS=1 node supabase/tests/rls.test.cjs
node supabase/tests/court-hours.test.cjs
SPOTIVITY_TEST_INTEGER_IDS=1 node supabase/tests/court-hours.test.cjs
node supabase/tests/admin-scope.test.cjs
SPOTIVITY_TEST_INTEGER_IDS=1 node supabase/tests/admin-scope.test.cjs
SITE_BASE_URL=http://127.0.0.1:8002/ node supabase/tests/browser.test.cjs
```

În mediul cloud curent, PGlite este instalat în `/workspace/shared/spotivity-rls-validation`; adaugă acel `node_modules` la `NODE_PATH` pentru a-l găsi. Testul browser necesită Playwright, Chromium și acces la baza de certificate de încredere. Aceste instalări nu modifică dependențele aplicației și nu sunt necesare pentru publicarea site-ului static.

Verificările SQL au trecut pentru ambele variante de ID: 85 de securitate, 21 de program și 20 pentru limitele adminilor/Storage. Suita browser verifică SDK-ul real, rezervări/anulări, căutarea, meniurile după rol și ferestrele publice/admin la 320, 390, 768 și 1440 px. Numerele actuale și limitele verificării sunt consemnate în [raportul pentru producție](../PRODUCTION_REVIEW.md).

Fotografiile păstrează cadrul 3:2, spațiul de 15 px și `object-fit: cover`; pagina principală folosește imaginile Realist configurate în `site_sporturi`, cu încadrare adaptată telefonului și desktopului. Câmpurile publice de dată/oră au 48 px și data afișată `DD.MM.YYYY`. La deschiderea unui dialog, stratul paginii este estompat direct, iar un strat gri acoperă viewportul și marginile; astfel blurul nu depinde de filtre backdrop imbricate în WebKit. Indicatoarele de scroll sunt gri, pe piste transparente. Formularul de înregistrare păstrează `display:flex`, spații de 22 px între câmpuri și X pe același rând cu taburile. Recuperarea parolei folosește o singură fereastră validată de SDK. Notificarea de rezervare durează 2 secunde, iar revenirea acasă restabilește fundalul principal.

Testele mobile folosesc viewporturi Chromium; Safari/DuckDuckGo pe iPhone real rămân de verificat înainte de lansarea finală.

Testele SQL folosesc roluri PostgreSQL reale și verifică regulile RLS și trigger-ele pentru ID-uri UUID și numerice. Testele browser folosesc SDK-ul Supabase real și o simulare Auth/REST care execută cererile în aceeași bază izolată; cererile către proiectul găzduit sunt interceptate. Acoperă autentificarea, înregistrarea, rezervarea, anularea, logout-ul, rolurile, afișarea sigură a mesajelor și ecranul mobil.

Coloanele utilizate din cele cinci tabele live au fost confirmate anterior prin cereri REST cu `limit=0`, fără citirea datelor personale. Testele izolate nu confirmă serviciile Auth, Storage și Realtime live sau datele și trigger-ele particulare ale proiectului tău. Verificările de după activare rămân necesare. RLS controlează accesul la date; nu înlocuiește verificarea hostingului, a integrărilor și un audit complet al aplicației.


## Baze sportive și restricția anulării după finalizare — 006/007

Pentru o instalare nouă, după 001 → 003 → 004 → 005, aplică întregul `006_sports_bases.sql`, apoi `007_completed_booking_cancellation.sql`. 006 creează `baze_sportive`, `baze_sportive_admini` și legătura opțională `terenuri.baza_sportiva_id`. Fișierul generic nu inventează baze sau grupări. 007 adaugă un trigger separat care refuză anularea unei rezervări încheiate pentru orice utilizator autentificat; verifică ora veche salvată, nu data trimisă de browser.

Baza publică trebuie să fie activă și să conțină cel puțin un teren activ. Superadminul gestionează structura și alocările prin funcția `save_sports_base`, executată cu drepturile utilizatorului (`SECURITY INVOKER`) și cu salvare atomică. Un administrator obișnuit are acces la descriere numai prin `baze_sportive_admini`; grantul nu modifică alocarea din `users_admin.terenuri`. Permisiunile sunt verificate de RLS și trigger-e, inclusiv la retragerea accesului.

În admin: **Baze sportive → selectează baza → Terenurile bazei** pentru terenuri existente; **Adaugă Teren → Baza sportivă** pentru unul nou. **Cine poate edita descrierea** acordă accesul unui admin obișnuit. Descrierile au maximum 2.000 de caractere și sunt afișate ca text. Partajarea păstrează numai parametrul `baza`, fără tokenuri Auth.

Testele relevante sunt `sports-bases.test.cjs` și `completed-booking.test.cjs`, fiecare cu și fără `SPOTIVITY_TEST_INTEGER_IDS=1`, plus integrarea browser. Detaliile și starea aplicării în proiectul existent sunt în [raportul curent](../PRODUCTION_REVIEW.md).

## 008 — profil editabil și email confirmat

Migrarea 008 este aplicată în proiectul existent. Cele trei profiluri lipsă au fost create; contactele existente, rezervările, chatul, rolurile și permisiunile bazelor au rămas neschimbate. SMTP propriu nu este încă configurat pentru livrarea confirmărilor către utilizatori publici.

Aplică `008_profile_edit.sql` după 007. Această migrare validează numai numele și telefonul care se modifică, impune UUID-ul propriu inclusiv pentru administratorii conectați și păstrează sincronizarea controlată a emailului prin triggerul Supabase Auth. Profilurile istorice care lipsesc sunt create din conturile Auth, fără rescrierea contactelor existente; coliziunile de email opresc tranzacția pentru verificarea proprietarului.

Schimbarea emailului se solicită din frontend prin `auth.updateUser({email}, {emailRedirectTo: siteHomeUrl()})`. Păstrează **Secure email change** activ și configurează SMTP propriu pentru livrarea către utilizatori publici. Nu actualiza manual emailul din `clienti` și nu dezactiva confirmarea pentru a ocoli problemele de livrare. Migrarea nu configurează SMTP și nu schimbă politica de înregistrare.

Testele `profile-edit.test.cjs` și `profile-edit-browser.test.cjs` verifică modificările proprii, refuzul accesului la alte profiluri, confirmarea explicită, starea emailului în așteptare și continuitatea rezervărilor/chatului după confirmare. Nu executa fișierele din `supabase/tests/` în proiectul real.

## 009 — fotografiile bazelor sportive

`009_base_photos.sql` este deja aplicată în proiectul existent după 008. Pentru un proiect nou, aplică întregul fișier numai după toate migrările precedente. Nu reinstala migrările vechi peste cele noi.

Migrarea adaugă `baze_sportive.poza` nullable și bucketul public `poze_baze_sportive`, limitat la JPEG/PNG/WebP/AVIF/GIF și 5 MiB. Nu folosește bucketul fotografiilor terenurilor. Calea canonică este `UUID-bază/UUID-imagine.ext`, iar atribuirea fotografiei cere un obiect existent în acel bucket pentru aceeași bază. Un administrator cu alocare explicită poate modifica descrierea și fotografia; structura bazei rămâne gestionată de superadmin. Grantul nu extinde accesul la alte terenuri, rezervări, clienți sau chat.

Politicile restrictive Storage verifică ambele căi la mutare/înlocuire și împiedică politicile permisive generale vechi să deschidă acest bucket. Retragerea permisiunii sau a rolului admin blochează imediat scrierile. URL-urile fotografiilor sunt publice; nu încărca documente private în acest bucket.

Aplicarea a fost precedată de o probă live cu rollback și verificări de păstrare a datelor/trigger-elor. După aplicare, probele cu rolul real `authenticated` au confirmat încărcarea metadatelor și atribuirea fotografiei propriei baze, refuzul altei baze și refuzul după revocare; toate probele au fost anulate prin rollback. Nu au fost încărcate fișiere demonstrative în Storage live.

`base-photos.test.cjs` verifică 47 de scenarii cu UUID și 47 cu ID numeric. `discovery-media-browser.test.cjs` verifică uploadul prin SDK real într-un Storage izolat, refuzul fișierelor nevalide, înlocuirea/ștergerea/curățarea după erori, afișarea publică, căutarea din antet și derularea automată. Nu executa testele în SQL Editor-ul proiectului real.
