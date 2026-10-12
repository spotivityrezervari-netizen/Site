# Verificare pentru producție — 12 octombrie 2026

Revizuire a codului, migrărilor SQL, configurației Supabase reale și publicării GitHub Pages. Corecțiile tehnice sunt implementate; lansarea publică finală mai necesită email, datele firmei și o soluție verificată de backup. Datele firmei și SMTP au fost amânate explicit de proprietar. Parolele noi păstrează minimum **6 caractere**, conform cererii sale.

Site: https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/

Admin: https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/admin.html

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

| Suită | Rezultat |
| --- | --- |
| `supabase/tests/rls.test.cjs` | 85 verificări UUID + 85 cu ID numeric |
| `supabase/tests/court-hours.test.cjs` | 21 verificări UUID + 21 cu ID numeric |
| `supabase/tests/admin-scope.test.cjs` | 20 verificări UUID + 20 cu ID numeric |
| `supabase/tests/browser.test.cjs` | 49 verificări cu SDK real + Chromium + PostgreSQL izolat |
| `supabase/tests/auth-recovery.test.cjs` | 6 verificări cu SDK real și Auth interceptat |

Total: **307 verificări automate**, plus verificarea sintaxei JS și a diff-ului. Cele 252 de verificări SQL din auditul aceleiași zile rămân valabile pentru migrările nemodificate; după schimbările de interfață au fost rulate integral cele 49 de verificări browser și cele 6 de recuperare/poze. Testele verifică limitele RLS, schimbarea contului în timpul recuperării, cursele din chat și XSS prin texte.

Interfața a fost verificată la **320, 390, 768 și 1440 px**: căutare cu filtre și diacritice, formularul de înregistrare, acoperirea blurului, antetul public fără suprapuneri, dashboardurile admin/superadmin, paginile orașelor, setările fiecărui teren, rezervarea manuală, programul, istoricul, chatul și alocarea angajaților. Probe cu nume lungi verifică încadrarea controalelor în chenare. Pictogramele sporturilor sunt decodate efectiv în browser; prețul mingii de 0 Lei rămâne 0. Aceste schimbări folosesc câmpurile și politicile existente; **nu necesită SQL suplimentar în proiectul live**.

Smoke test local și publicat: pagina principală, cele patru sporturi, imagini, login, Escape, viewport mobil, pagina admin fără autentificare și citiri live Supabase. Cererile de scriere sunt blocate în smoke test. După push se compară fișierele publicate cu cele din Git, pentru a confirma versiunea servită efectiv.

## Verificări directe Supabase

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
```

Repetă fiecare suită SQL cu `SPOTIVITY_TEST_INTEGER_IDS=1`. Pentru cele două suite de browser adaugă la `NODE_PATH` runtime-ul Playwright din mediul curent și setează `SITE_BASE_URL=http://127.0.0.1:8010/`. Păstrează verificarea TLS activă; folosește mecanismul de acces NSS al mediului dacă Chromium nu poate citi certificatele.

`SITE_BASE_URL=https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/ node scripts/smoke-site.cjs` verifică publicarea fără scrieri. Nu rula `tests/schema.sql` sau fișierele de test în SQL Editor-ul proiectului real. Pentru un alt proiect, aplică 001 → 003 → 004 după backup/inventar; 002 sunt exemple de roluri. **Nu reinstala 001/003 în Rendez-Vous.**
