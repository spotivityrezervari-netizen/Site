# Instalarea protecțiilor Supabase și a rolurilor Spotivity

Acest pachet conține migrarea bazei de date și frontend-ul compatibil. Pregătirea fișierelor în GitHub nu execută automat SQL-ul în Supabase. Aplicarea în proiectul tău se face din Dashboard, în ordinea descrisă mai jos. Testele automate folosesc date fictive într-un PostgreSQL izolat; proiectul live nu a fost migrat prin aceste teste.

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

Deschide ramura `codex/spotivity-rls-security` în GitHub, apoi folderul `Idee Site/supabase`:

- [000_preflight.sql](000_preflight.sql): inventar fără modificări, pentru verificarea bazei existente.
- [001_security.sql](001_security.sql): migrarea completă, inclusiv RLS, funcții, trigger-e, Storage și disponibilitate.
- [002_admin_examples.sql](002_admin_examples.sql): exemple pentru primul superadmin și adminii alocați.

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

## 5. Configurează autentificarea

În Dashboard, denumirile paginilor pot varia puțin între versiunile Supabase:

1. În **Authentication → Sign In / Providers → Email**, păstrează autentificarea cu email/parolă și **Confirm email** activ. Un client înregistrat trebuie să confirme emailul înainte de autentificare.
2. În **Authentication → URL Configuration**, setează **Site URL** la adresa HTTPS reală a site-ului, de exemplu `https://spotivity.ro/` dacă acesta este domeniul public folosit.
3. La **Redirect URLs**, adaugă adresele exacte folosite de site pentru confirmare și resetare. Codul actual de resetare folosește `https://spotivity.ro/`; dacă publici pe alt domeniu, adaptează și `redirectTo` din `js/app.js`. Pentru proiectul de test, folosește adresa frontend-ului de test și un redirect de resetare corespunzător în copia de cod. Nu redirecționa utilizatorii de test către producție.
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
- Calculează prețul rezervărilor clientului din `terenuri` și `cu_minge`, verifică orele 12:00–22:00, minimum o oră în avans și următoarele 7 zile. Mingea se taxează pe primul rând al pachetului, ca în interfață. Adminii pot introduce rezervări manuale și blocaje fără cont client asociat.
- Previne două rezervări active pentru același teren/oră printr-un index unic și permite anularea oricând a unei rezervări proprii active.
- Publică numai disponibilitatea: ID opac, teren, dată și oră. Emailul, profilul și prețul clientului nu sunt publicate pentru a afișa orele ocupate.
- Limitează chat-ul clientului la terenuri cu chat activ și o rezervare activă neîncheiată. Clienții și adminii obișnuiți pot marca mesajele primite drept citite, fără să le rescrie conținutul.
- Creează schema internă `spotivity_private`. Nu o adăuga la schemele expuse de Data API.

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
3. În GitHub, compară ramura `codex/spotivity-rls-security` cu `main` și integrează modificările după ce baza reală este pregătită. Publicarea poate porni automat când actualizezi `main`, dacă hostingul urmărește acea ramură; verifică setarea hostingului înainte de integrare.
4. Publică toate fișierele compatibile împreună: `index.html`, `admin.html`, `js/app.js`, `js/admin.js` și noul `js/security.js`. Dacă hostingul servește `Idee Site/`, păstrează acea rădăcină de publicare. Documentația și SQL-ul nu înlocuiesc fișierele frontend.
5. Verifică în `js/db.js` publicat URL-ul și cheia publică ale proiectului real. Invalidează cache-ul/CDN dacă există și reîncarcă pagina; paginile actualizate folosesc versiuni noi pentru fișierele JS.

Nu publica frontend-ul nou înainte de migrare: folosește coloane și tabelul de disponibilitate care lipsesc din vechea schemă. Revenirea la frontend-ul vechi nu anulează migrarea bazei; pentru o restaurare folosește un plan verificat și backup-ul corespunzător.

## 10. Verificări înainte de lansare

Folosește conturi distincte și ferestre/sesiuni separate pentru client, admin alocat și superadmin. În Dashboard, contul proprietarului poate vedea toate datele și nu reprezintă un test al RLS aplicat clientului.

- **Vizitator:** vede terenurile active și orele ocupate; nu poate vedea profilele, emailurile, rezervările private, chat-ul sau rolurile.
- **Doi clienți:** înregistrare cu confirmare, autentificare, refresh și logout; fiecare vede numai propriile date. O încercare de a rezerva simultan aceeași oră lasă cel mult o rezervare activă.
- **Anulare:** testează o rezervare proprie cu mai mult de 6 ore înainte, una cu mai puțin de 6 ore, una începută și una încheiată, folosind date de test. Toate cele încă `activa` se pot anula; alt client nu le poate anula. Pentru rezervările încheiate, deschide și istoricul. Verifică starea `anulata` și actualizarea disponibilității pentru orele viitoare.
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
SITE_BASE_URL=http://127.0.0.1:8002/ node supabase/tests/browser.test.cjs
```

În mediul cloud curent, PGlite este instalat în `/workspace/shared/spotivity-rls-validation`; adaugă acel `node_modules` la `NODE_PATH` pentru a-l găsi. Testul browser necesită Playwright, Chromium și acces la baza de certificate de încredere. Aceste instalări nu modifică dependențele aplicației și nu sunt necesare pentru publicarea site-ului static.

Rezultatele versiunii actualizate: **50 de verificări SQL pentru fiecare variantă de ID-uri, UUID și numerice, și 11 verificări în browser**, toate trecute în mediul izolat.

Testele SQL folosesc roluri PostgreSQL reale și verifică regulile RLS și trigger-ele pentru ID-uri UUID și numerice. Testele browser folosesc SDK-ul Supabase real și o simulare Auth/REST care execută cererile în aceeași bază izolată; cererile către proiectul găzduit sunt interceptate. Acoperă autentificarea, înregistrarea, rezervarea, anularea, logout-ul, rolurile, afișarea sigură a mesajelor și ecranul mobil.

Coloanele utilizate din cele cinci tabele live au fost confirmate anterior prin cereri REST cu `limit=0`, fără citirea datelor personale. Testele izolate nu confirmă serviciile Auth, Storage și Realtime live sau datele și trigger-ele particulare ale proiectului tău. Verificările de după activare rămân necesare. RLS controlează accesul la date; nu înlocuiește verificarea hostingului, a integrărilor și un audit complet al aplicației.
