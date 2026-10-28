# Publicarea sigură a site-ului

Publicarea Netlify este oprită la cererea proprietarului, pentru economisirea creditelor. Actualizările se trimit în Git cu `[skip netlify]` în mesajul commitului; nu se apelează API-uri de deploy sau build hooks. Instrucțiunile Netlify de mai jos descriu configurația pregătită pentru o publicare ulterioară.

HTML, CSS și JavaScript se descarcă în browser și rămân vizibile prin F12. Minificarea și blocarea tastelor nu protejează datele. Autorizarea se face în Supabase, cu identitatea verificată și permisiunile curente, inclusiv pentru cereri directe către API.

Pagina include politica CSP și `no-referrer` înainte de încărcarea resurselor, astfel încât protecțiile aplicabile prin metadate funcționează și pe GitHub Pages. Scripturile și conexiunile neaprobate, handler-ele inline, obiectele și baza URL injectată sunt refuzate. `frame-ancestors`, HSTS și celelalte antete HTTP din configurația Netlify necesită suportul gazdei; o etichetă meta nu le înlocuiește.

Linkurile salvate se afișează numai prin HTTPS, fără credențiale în URL sau caractere de control. Câmpurile istorice sunt escapate înainte de inserarea în HTML, iar erorile brute ale chatului nu se scriu în consola clientului. Buildul refuză și URL-urile webhook private Make, secretele OAuth și tokenurile privilegiate recunoscute. Testele folosesc valori fictive; niciun scanner nu poate identifica toate formele posibile de secret.

Migrarea `026_retired_court_identity.sql` este aplicată în Supabase pentru a împiedica transferul istoricului între terenuri prin reutilizarea unui nume sau ID. Registrele identităților sunt private; clienții își păstrează istoricul, iar permisiunile terenurilor existente și interdicția anulării rezervărilor finalizate sunt păstrate. Această aplicare SQL nu reprezintă un deployment Netlify.

## Ce se publică

Din rădăcina repository-ului:

```bash
node scripts/build-public.mjs
```

Buildul generează `dist/` din lista explicită `scripts/public-files.json`: pagina principală, CSS, JavaScript și imagini. Păstrează căile relative și ordinea scripturilor existente. Copiază separat `deploy/netlify/_headers` pentru antetele HTTP. Nu copiază SQL, teste, documentație, funcții Edge, fișiere de mediu sau source maps. Nu introduce variabile de mediu în frontend.

Fișierele noi de interfață trebuie adăugate în manifest după verificare. Buildul refuză căi nesigure, symlinkuri și formate cunoscute de chei privilegiate. Verifică referințele locale HTML/CSS și reconstruiește directorul pentru a elimina fișierele vechi. Scanarea este o protecție suplimentară pentru formate cunoscute, nu un detector universal de secrete.

`netlify.toml` stabilește:

```toml
[build]
  base = "."
  command = "node scripts/build-public.mjs"
  publish = "dist"
```

Netlify trebuie să construiască repository-ul din rădăcină și să publice `dist`, nu folderul sursă `Idee Site`. Node.js 18 sau mai nou este suficient; nu sunt necesare pachete npm pentru build. Publicarea manuală se face tot din `dist/`. Nicio cheie `service_role`, PAT, cheie de email sau secret de anulare nu se introduce în JavaScript sau în manifest. Cheia Supabase `anon` este publică intenționat; drepturile sunt controlate de RLS/RPC.

## Protecțiile HTTP

Antetele limitează scripturile la fișierele proprii și SDK-ul Supabase pinuit cu SRI. Blochează elementele `<script>` inline, `eval`, obiectele încorporate și încadrarea site-ului într-un iframe. Conexiunile API și WebSocket sunt permise numai către site și proiectul Supabase configurat. URL-urile de fotografii HTTPS și previzualizările `data:`/`blob:` sunt păstrate.

Controalele statice și cele generate dinamic folosesc `addEventListener`, fără atribute `onclick`/`onchange` și fără interpretarea datelor ca JavaScript. `script-src-attr 'none'` blochează inclusiv handler-ele injectate în HTML. Stilurile inline rămân permise pentru interfața existentă. Politica CSP este o protecție suplimentară: textele introduse de utilizator trebuie validate și afișate în continuare ca text sau escapate. Nu lărgi `script-src` cu `unsafe-inline` ori `unsafe-eval` și nu reactiva handler-ele inline pentru a rezolva o eroare de integrare.

Formularele de autentificare și înregistrare șterg parolele după cererea Auth și la închiderea dialogului sau schimbarea sesiunii. Aceasta reduce păstrarea inutilă a parolei în DOM; nu împiedică titularul sesiunii să inspecteze propriile cereri. Tokenul sesiunii curente este accesibil browserului în arhitectura Supabase existentă. Cheia publică și codul interfeței rămân publice; cheile privilegiate și datele altor conturi trebuie protejate pe server.

`nosniff` împiedică interpretarea unui tip de fișier greșit, `no-referrer` reduce expunerea URL-urilor cu parametri Auth, iar HSTS impune HTTPS pentru domeniul vizitat. HSTS nu folosește `includeSubDomains` sau preload. Politica de permisiuni oprește API-urile de cameră/microfon/geolocație/plată pe care aplicația nu le folosește; alegerea fotografiilor prin selectorul de fișiere rămâne disponibilă. HTML, JS și CSS se revalidează la încărcare.

## Supabase și domeniul propriu

`club-applications` și `booking-workflow` permit numai originile exacte `https://spotivity.ro`, `https://www.spotivity.ro`, vechea origine GitHub Pages și localhost pentru dezvoltare. Domenii asemănătoare, porturi arbitrare și subdomenii Netlify necontrolate sunt refuzate. CORS nu înlocuiește autentificarea: funcțiile verifică în continuare JWT-ul, rolul actual și permisiunile. `booking-notifications` rămâne rezervată apelurilor de serviciu.

Publicarea statică pe Netlify nu publică funcțiile Supabase. Cele două funcții modificate necesită deployment separat; de exemplu, prin Supabase CLI autentificat securizat:

```bash
supabase functions deploy club-applications --project-ref ndubcdwohqzgxpuiowye --no-verify-jwt
supabase functions deploy booking-workflow --project-ref ndubcdwohqzgxpuiowye --no-verify-jwt
```

Aceste funcții verifică explicit identitatea în handler; rutele de înscriere și rezervare guest sunt publice intenționat. Păstrează secretele deja configurate în mediul Edge. Nu schimba politica de confirmare email sau rolurile pentru deployment. În configurarea Supabase Auth, verifică și URL-urile exacte de întoarcere pentru domeniul propriu, păstrând callbackurile legitime existente. Nu introduce wildcarduri globale. Configurația live Auth nu a putut fi citită în această sesiune din cauza răspunsului HTTP 401 al bindingului administrativ.

## Verificare

Din rădăcina repository-ului:

```bash
node --test scripts/tests/build-public.test.mjs
node --test 'Idee Site/supabase/tests/club-applications-edge.test.cjs' 'Idee Site/supabase/tests/booking-workflow-edge.test.cjs' 'Idee Site/supabase/tests/booking-notifications-edge.test.cjs'
node 'Idee Site/supabase/tests/public-deployment-browser.test.cjs'
```

Suitele browser necesită Playwright și Chromium; suitele de integrare folosesc PGlite izolat. `public-artifact-server.cjs` din teste servește `dist/` cu antetele Netlify reale pentru verificările locale. Nu executa fixture-uri pe Supabase live.

După deployment, verifică pagina, antetele, autentificarea, rezervările și uploadul fotografiilor. Cererile directe către `/supabase/013_admin_integration.sql`, `/supabase/functions/club-applications/index.ts`, `/supabase/tests/schema.sql`, `/scripts/` și documentația internă trebuie să răspundă cu 404. Faptul că GitHub a acceptat un commit nu confirmă deploymentul Netlify.

## Alte copii ale codului

`_config.yml` exclude sursele server, testele și documentația din buildul Jekyll al vechii adrese GitHub Pages, păstrând pagina la `/Site/Idee%20Site/`. Antetele personalizate Netlify nu se aplică pe GitHub Pages. Acest fișier este eficient numai dacă publicarea Pages folosește Jekyll; un workflow separat trebuie să aplice propria listă de fișiere publice.

Sursele și istoricul dintr-un repository GitHub public rămân accesibile în GitHub. Nici excluderile de deployment, nici trecerea repository-ului pe privat nu retrag copii deja descărcate. Nu publica niciodată secrete în Git.

## Verificarea din 27 octombrie 2026

Întărirea CSP și curățarea parolelor au fost probate pe versiunea care include navigarea din email și raportul de anulări târzii. Au trecut cele 12 teste ale buildului, 6 verificări ale pachetului public cu antetele reale, 84 de verificări complete browser sub CSP, 7 verificări Auth/recuperare și 17 pentru Google OAuth. Cele 62 de teste Node pentru emailuri/notificări/contextul rezervării/raport și cele 11 verificări browser ale funcțiilor noi au trecut separat. Fixture-ul general instalează acum migrările până la 023, fără a executa SQL pe proiectul live.

Auditul live a citit numai configurație și metadate: toate cele 10 tabele publice au RLS activ; cele 6 tabele private nu acordă acces rolurilor din browser. Cererile anonime către clienți, roluri, rezervări private, chat, cereri și alocările bazelor au fost refuzate cu HTTP 401; aceleași credențiale publice au primit HTTP 200 pentru catalog și disponibilitate. Disponibilitatea publică are numai ID, teren, zi și oră. Bucketul cererilor este privat, iar uploadurile foto permit numai formate raster de maximum 5 MB. Cele două RPC-uri pentru contextul din email și anulări târzii au autorizare verificată și teste izolate suplimentare.

Smoke testul pe pachetul `dist`, cu antetele Netlify și citiri reale din Supabase, a trecut pentru desktop/mobil, imagini, sporturi, căutare, baze și administrarea ascunsă vizitatorilor. TLS și SRI au rămas active, iar scrierile au fost blocate. Această verificare nu este o garanție împotriva tuturor vulnerabilităților și nu înlocuiește verificarea deploymentului publicat.
