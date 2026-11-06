# Emailuri din panoul superadminului

**Panou activ din 6 noiembrie 2026**, după aprobarea explicită a proprietarului. Migrarea 030 este aplicată în Supabase live, cele două scenarii Make sunt actualizate, iar `announcement_panel_config.ready=true`. La verificare: 7 clienți și 3 administratori eligibili, zero campanii aprobate și zero destinatari trimiși în timpul activării.

Pentru lansarea pe domeniul final, migrarea031 este pregătită separat în Git pentru linkurile `spotivity.ro`; nu este încă aplicată. Vezi [raportul de lansare](../RELEASE_READY.md).

## Utilizare

În contul superadminului: **Administrare → Setări emailuri**.

1. Alege **Numai clienți** sau **Numai administratori**. Clienții exclud toate conturile/mailboxurile administrative; grupul administratorilor include superadminii. Oaspeții fără cont nu sunt adăugați.
2. Completează subiectul și mesajul. Poți atașa o fotografie JPG/PNG de maximum 5 MB. Imaginea se adaptează la lățimea emailului și își păstrează proporțiile.
3. Apasă **Previzualizează și verifică destinatarii**. Se salvează mesajul și lista actuală; acest pas nu trimite emailuri.
4. Verifică numărul și mesajul, bifează confirmarea, apoi apasă **Trimite emailurile**. Dacă grupul s-a schimbat, este necesară o previzualizare nouă. Aprobarea expiră după 24 de ore.
5. Urmărește istoricul. „Acceptate de Gmail” arată succesul API, nu sosirea în inbox. „Rezultat incert” nu se retrimite automat. Poți opri destinatarii încă neprocesați; emailurile deja acceptate sau aflate în curs nu pot fi retrase.

Modificarea textului, grupului sau imaginii invalidează confirmarea. Un dublu click sau o reluare a aceleiași campanii nu resetează destinatarii procesați. După o eroare verifică istoricul înainte să creezi un anunț nou.

## Organizarea Make

Se păstrează **două scenarii active**, fără schimbarea abonamentului:

- **7938404 — Rezervări, anulări, bun venit și anunțuri**: ruta tranzacțională actuală plus două rute distincte pentru campanii, cu acreditări separate pentru clienți/admini.
- **7938798 — Chat pentru clienți și administratori**: ruta normalizată actuală de chat.

Cele două scenarii manuale 8377771/8377772 rămân inactive, disponibile pentru compatibilitate; utilizatorul nu mai trebuie să deschidă Make pentru compunerea unui anunț din panou. Nu se activează un al treilea scenariu.

Webhookul primește numai tipul campaniei și UUID-ul. Adresa, subiectul și HTML-ul sunt obținute exclusiv din SQL, după verificarea aprobării și a rolului actual al destinatarului. Conexiunile HTTP existente 276701/276702 injectează separat cheile grupurilor. Gmail are un singur To, fără CC/BCC. Nu există tokenuri Make, chei private Supabase sau URL-uri webhook în codul public.

Rutele campaniilor folosesc **Ignore pentru bundle-ul cu eroare**, fără retry Gmail: continuă celelalte persoane, iar registrul SQL păstrează rezultatul incert. O eroare de campanie nu trebuie să dezactiveze scenariul notificărilor tranzacționale. Destinatarii încă `pending` pot fi repuși în coadă de cron la două minute; cei `sending`/`sent` nu sunt niciodată revendicați din nou.

Pentru rezervări/chat, identificatorul este rezervat în Data Store **înainte de Gmail**, cu execuție secvențială și `overwrite=false`. În caz de eroare, verificarea manuală este necesară; o înregistrare existentă în Data Store înseamnă ID rezervat/procesat, nu dovadă de livrare.

## Dublurile din fluxurile vechi

Auditul live a găsit două triggere `supabase_functions.http_request`: `webhook-chat-nou` pe `mesaje_chat` și `webhook_reervare_noua` pe `rezervari`. Chatul administrativ poate intra simultan în ruta veche și în outboxul actual, producând două emailuri. Migrarea 030 retrage numai aceste triggere, după verificarea identității funcției lor. Blueprinturile noi retrag rutele raw-row corespunzătoare; cele șapte tipuri actuale rămân pe fluxurile normalizate.

## Migrarea și activarea controlată

Fișier: `030_superadmin_announcement_panel.sql`.

- Adaugă autorul, imaginea, anularea și data punerii în coadă la campaniile private existente.
- Adaugă RPC-uri autorizate prin UUID-ul Auth și rolul `users_admin.is_super` curent; nu acceptă roluri din browser.
- Creează bucketul public `announcement_images`, cu inserare administrativă, JPEG/PNG și limită de 5 MB. Un trigger protejează imaginile deja fixate într-o previzualizare inclusiv împotriva politicilor Storage generale existente.
- Actualizează numai randarea din `announcement_claim`; păstrează cheia grupului, verificarea destinatarului, lease-ul și semantica fără retrimitere.
- Adaugă recuperarea cozii prin pg_cron. Configurația privată `announcement_panel_config.ready` pornește **false**.
- Retrage cele două webhookuri raw-row de mai sus. Nu modifică profiluri, roluri, alocări sau rezervări existente.

Ordinea folosită la activare a fost: verificare SQL cu rollback și comparații ale datelor/politicilor existente; aplicarea 030; citirea blueprinturilor și verificarea versiunilor curente; actualizarea celor două scenarii cu `baseVersion`; recitire/verificare a rutelor și a stării active; probe Make cu UUID-uri fără campanii aprobate, care trebuie să se oprească înainte de Gmail; activarea flagului privat `ready` numai după verificare. Proba și aplicarea au confirmat păstrarea datelor din tabelele publice, a funcțiilor existente (exceptând randarea aprobată din claim) și a politicilor RLS existente. Scenariile active au acum versiunile 14 (rezervări/anunțuri) și 8 (chat). Ambele probe live au returnat HTTP200, modulele SQL202/302 au reușit, iar modulele Gmail12/206/306 nu au fost atinse. O actualizare Make incompletă trebuie să lase panoul în mod de previzualizare.

La o revenire, păstrează coada și registrul. Dezactivează numai `announcement_panel_config.ready`; nu reactiva webhookurile vechi în paralel cu outboxul și nu reseta destinatarii `sending`/`sent`.

## Inventarul verificat

1. Confirmare rezervare către client/oaspete.
2. Rezervare nouă către personalul autorizat.
3. Confirmare anulare către client, inclusiv anulare parțială.
4. Anulare către personalul autorizat.
5. Mesaj client către administrator.
6. Răspuns administrator către client.
7. Bun venit pentru un cont nou eligibil.
8. Anunț exclusiv pentru clienți.
9. Anunț exclusiv pentru administratori.

Separat de Make: recuperarea parolei și schimbarea emailului sunt în Supabase Auth. Verificarea din 6 noiembrie a confirmat lipsa SMTP extern, limita de două emailuri Auth/oră și confirmarea automată a înscrierilor. Aceste setări nu sunt modificate de panoul de anunțuri.

## Verificări locale

- `NODE_PATH=/workspace/shared/spotivity-rls-validation/node_modules:$NODE_PATH node 'Idee Site/supabase/tests/announcement-panel.test.cjs'`
- Aceeași configurare pentru `announcement-panel-browser.test.cjs`: Chromium + SQL real izolat, cereri externe blocate, inclusiv previzualizare cu imagine la 320/390/768/1280 px.
- `node scripts/tests/make-panel-mail.test.mjs`
- Regresie: `announcement-campaigns.test.cjs`, `transactional-mail.test.cjs`, `account-welcome.test.cjs`, `notification-outbox.test.cjs`, `scripts/tests/make-announcements.test.mjs`.
- Publicare Git: `node --test scripts/tests/build-public.test.mjs` și `node scripts/build-public.mjs`. Artifactul conține numai fișierele browser aprobate; SQL/testele/generatoarele Make nu intră în artifact.
