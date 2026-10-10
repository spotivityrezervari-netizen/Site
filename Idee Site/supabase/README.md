# Protecția datelor și rolurile Spotivity

Acest pachet conține o migrare SQL și frontend-ul compatibil. SQL-ul nu a fost executat pe proiectul Supabase live. Testele folosesc exclusiv date fictive într-un PostgreSQL izolat.

## Accesul acordat

| Rol | Date și operații permise |
| --- | --- |
| Vizitator | Terenuri active, imagini publice și ore ocupate, fără datele clienților. |
| Client autentificat | Profilul propriu, rezervările și chat-ul propriu. Poate rezerva, modifica numele/telefonul și anula cu cel puțin 6 ore înainte. |
| Admin | Rezervări, chat și setări pentru terenurile alocate; datele clienților care au rezervări la acele terenuri. Nu poate acorda roluri sau crea/șterge terenuri. |
| Superadmin | Gestionarea tuturor datelor aplicației: terenuri, setări, rezervări, profiluri, chat, imagini și roluri admin. Poate redenumi terenuri, cu actualizarea referințelor. |

Superadminul este un rol al aplicației, nu proprietarul proiectului Supabase. Nu primește cheia `service_role`, acces la parole, SQL arbitrar, facturare sau dreptul de a ignora constrângerile bazei de date. Conturile Auth și parolele adminilor se creează în Dashboard; panoul site-ului alocă rolurile conturilor existente. Nu introduce niciodată o cheie `service_role` în frontend.

## Ce schimbă migrarea

- Activează RLS și înlocuiește politicile existente pentru cele cinci tabele ale aplicației. Politicile vechi permisive pot anula protecția unor politici noi dacă sunt păstrate.
- Leagă profilele și rolurile prin `user_id`, iar rezervările și chat-ul prin `client_user_id`, de `auth.users.id`. `localStorage`, numele sau `user_metadata.is_super` nu acordă permisiuni. Retragerea rolului are efect în baza de date imediat, fără un JWT nou.
- Creează automat profilul printr-un trigger Auth, inclusiv când înregistrarea cere confirmarea emailului. Numele și telefonul provin din metadata; rolurile nu provin din metadata.
- Publică disponibilitatea în `rezervari_disponibilitate`, cu numai ID-ul opac al rezervării, terenul, data și ora. Tabelul privat `rezervari` nu devine public pentru a afișa orele ocupate. Disponibilitatea se sincronizează prin trigger și este inclusă în publicația Realtime dacă aceasta există.
- Calculează prețul clientului din `terenuri` și `cu_minge`, în loc să accepte un preț trimis de browser. Mingea se taxează pe primul rând al pachetului, ca în interfața existentă. Adminii pot introduce rezervări manuale și blocaje fără un cont client asociat.
- Folosește o cheie unică pentru un singur rând activ per teren/oră, verifică programul 12:00–22:00, minimum o oră în avans, intervalul următoarelor 7 zile și anularea cu minimum 6 ore în avans. Aceste reguli ale clientului nu limitează rezervările manuale ale adminului alocat sau superadminului.
- Permite mesaje ale clientului numai pentru terenuri cu chat activ și o rezervare activă neîncheiată. Clienții și adminii obișnuiți pot marca doar mesajele primite drept citite; nu pot rescrie conținutul mesajelor.
- Configurează bucket-ul public `poze_terenuri` pentru imagini JPEG/PNG/WebP/AVIF/GIF de maximum 5 MB. Adminii scriu numai în prefixul propriului UUID; superadminii gestionează toate imaginile. Politicile restrictive blochează scrierile neautorizate chiar dacă există politici Storage vechi generale. Alte bucket-uri păstrează politicile existente. Fișierele deja publice rămân publice.
- Păstrează identitatea la schimbarea emailului Auth și sincronizează emailurile de contact. Rularea ulterioară a migrării nu realocă istoricul unui utilizator șters unui cont nou cu același email.

## Înainte de aplicare

1. Folosește mai întâi un proiect Supabase de test cu o copie a structurii și datelor, apoi păstrează un backup înainte de migrarea proiectului real. Aplică migrarea și frontend-ul compatibil într-o fereastră de mentenanță; clienții cu vechiul cod deschis trebuie să reîncarce pagina.
2. Rulează `000_preflight.sql` în SQL Editor. Verifică structura și politicile reale, trigger-ele Auth existente, funcțiile `SECURITY DEFINER` publice și view-urile care pot ocoli RLS. Schema folosită în teste este bazată pe documentul furnizat și pe frontend; un inventar REST cu zero rânduri poate confirma coloane, nu toate constrângerile, politicile și trigger-ele proiectului live.
3. Auditează personal rândurile existente din `users_admin`: păstrează numai rolurile acordate de tine. Migrarea le leagă de utilizatorii Auth existenți și confirmați; nu poate demonstra că un rol dintr-o bază anterior deschisă a fost acordat legitim. Creează în Auth conturile adminilor lipsă înainte de aplicare.
4. Verifică anii rezervărilor vechi. Codul existent scrie `Lun, 05.01`, deși documentul descria `YYYY-MM-DD`. Migrarea deduce anul din `timestamp_start`/`created_at`, cu trecerea decembrie → ianuarie, și convertește la ISO. Nu poate recupera sigur intenția unei date fără an; corectează în copia de test orice rând ambiguu înainte de aplicarea live. Datele noi și `starts_at` folosesc `Europe/Bucharest`.
5. Rezolvă emailurile sau numele de teren duplicate, rezervările active suprapuse și datele nevalide. Migrarea se oprește și face rollback pentru aceste cazuri; nu șterge automat datele care intră în conflict. Numele terenurilor nu pot conține virgule deoarece alocările vechi folosesc o listă separată prin virgule.
6. Verifică trigger-ele Auth care creează deja profile. Două trigger-e care inserează același profil pot bloca înregistrarea; înlocuiește logica duplicată numai după ce identifici rolul ei. Profilele istorice fără un cont Auth asociat rămân inaccesibile clienților și pot necesita reconciliere administrativă înainte de o nouă înregistrare cu același email.
7. În Auth păstrează confirmarea emailului activă, configurează URL-ul site-ului și redirect-urile exacte de confirmare/resetare, o politică de parole adecvată și limitele de autentificare. Pentru conturile privilegiate, configurează MFA și un flux care îl verifică; acest pachet nu pretinde că implementează MFA. Integrările Make.com/backend trebuie să folosească autentificare proprie cu privilegii potrivite, nu accesul public al browserului.

Migrarea refuză aplicarea dacă găsește RPC-uri publice `SECURITY DEFINER` apelabile sau view-uri/materialized view-uri expuse care pot ocoli RLS pe datele private. Analizează-le separat. Un view obișnuit destinat utilizatorilor autentificați poate necesita `security_invoker = true` și grant-uri potrivite; un materialized view necesită un design separat. Nu elimina verificarea numai pentru a forța aplicarea.

## Ordinea de activare

1. După verificările de mai sus, rulează întregul `001_security.sql` ca `postgres` în SQL Editor, în proiectul de test. Scriptul este tranzacțional și poate fi rerulat după o aplicare reușită.
2. Creează contul inițial de superadmin în **Authentication → Users**, cu email confirmat și parolă puternică. Rulează separat exemplul corespunzător din `002_admin_examples.sql`, înlocuind adresa `.invalid`. Dacă acel cont exista înainte de migrare, nu îl crea din nou.
3. Creează în același mod conturile adminilor obișnuiți. Din panoul superadminului alocă emailul, numele și terenurile exacte; alternativ, folosește exemplul SQL. Pentru schimbarea rolurilor existente folosește Dashboard/SQL Editor; interfața existentă alocă doar roluri noi.
4. Publică frontend-ul adaptat: `index.html`, `admin.html`, `js/app.js`, `js/admin.js` și noul `js/security.js`. Nu publica aceste modificări pe site înainte de migrare: folosesc coloane și un tabel care nu există în vechea schemă. Schimbă versiunea fișierelor JS sau invalidează cache-ul când publici.
5. Verifică în proiectul de test înregistrarea cu email confirmat, autentificarea, refresh-ul, logout-ul, rezervarea din două sesiuni pentru aceeași oră, anularea, chat-ul, upload-ul și fiecare rol. Testează atât cererile permise, cât și cele refuzate. După validare, repetă aceeași ordine în proiectul real și pe hosting.

Crearea unui superadmin nu este permisă unui client sau admin obișnuit. Primul rol se acordă din SQL Editor/Dashboard. Poți utiliza această cale de recuperare dacă superadminul își retrage propriul rol; pachetul nu blochează administrarea legitimă prin Dashboard.

## Verificări repetabile

Din `Idee Site`, cu serverul local pornit și cu PGlite și Playwright instalate în afara proiectului:

```bash
node supabase/tests/rls.test.cjs
SPOTIVITY_TEST_INTEGER_IDS=1 node supabase/tests/rls.test.cjs
SITE_BASE_URL=http://127.0.0.1:8002/ node supabase/tests/browser.test.cjs
```

În mediul cloud curent PGlite a fost instalat în `/workspace/shared/spotivity-rls-validation`; pentru a-l găsi, adaugă acel `node_modules` la `NODE_PATH`. Nu există o modificare a dependențelor aplicației. Testul în browser necesită Chromium și acces la baza sa de certificate de încredere, ca verificările inițiale de configurare.

Rezultatele curente: 47 de verificări PostgreSQL au trecut pentru fiecare dintre variantele cu ID-uri UUID și numerice. Testele în browser acoperă autentificarea, o rezervare pe două ore, înregistrarea cu profil creat de trigger, logout-ul, accesul adminului alocat, blocarea unei ore, afișarea sigură a mesajelor și ecranul mobil. Coloanele utilizate din cele cinci tabele live au fost confirmate prin cereri REST cu `limit=0`, fără citirea datelor personale. Configurarea completă și activarea live nu au fost validate.

`tests/schema.sql` este exclusiv un fixture pentru baza izolată: nu îl rula pe proiectul real. Testele SQL folosesc roluri PostgreSQL reale și verifică regulile RLS și trigger-ele. Testele browser folosesc SDK-ul Supabase real și o simulare a API-ului Auth/REST care execută cererile în aceeași bază izolată; toate cererile către proiectul găzduit sunt interceptate. Aceste teste nu confirmă serviciile Auth, Storage și Realtime ale proiectului live și nici datele sau trigger-ele lui particulare. Verificarea live rămâne necesară după activare.

RLS controlează accesul la date. Un rezultat pozitiv al acestor teste nu înlocuiește verificarea configurării Supabase, a integrărilor, a hostingului și un audit complet al aplicației.
