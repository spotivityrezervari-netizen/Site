# Remedieri tehnice — noiembrie 2026

Această actualizare repară problemele identificate la audit. Publicarea pe Netlify rămâne oprită; commiturile intermediare includ `[skip netlify]`. Un push Git nu aplică singur migrările sau funcțiile Supabase.

## Funcții și date

Ordinea de instalare pentru o bază aflată la migrarea 035 este **036 → 037 → 038 → 039 → 040 → 041 → 042**, înaintea noului frontend. Nu reaplica migrările vechi peste o instalare existentă. Protecțiile migrărilor refuză obiecte necunoscute sau versiuni deja depășite.

- **036:** anularea explicită a unei rezervări manuale eligibile folosește acum fluxul de incidente și notificări al rezervărilor grupate. Nu transformă în masă rezervările vechi și nu generează emailuri istorice. Contactele istorice nevalide rămân anulabile; nu se inventează destinatari pentru ele.
- **037:** restricții manuale pentru rezervări, cu permisiuni verificate în SQL și jurnal privat. Un administrator poate acționa numai pentru terenurile alocate; superadminul poate alege și întregul site. Restricția nu închide contul și nu anulează rezervările existente.
- **038:** API-ul, SQL și rendererul de email acceptă același contract de adresă. O adresă care nu poate fi folosită de expeditor este respinsă înainte de ocuparea unui interval nou.
- **039:** ștergerea unei fotografii din `poze_terenuri` este permisă numai în limitele de acces existente și dacă niciun teren nu o mai referă, inclusiv terenurile ascunse utilizatorului. Migrarea nu șterge obiecte existente.
- **040:** prezența pentru rezervările manuale/istorice folosește aceeași validare a emailului. Contactele absente sau neutilizabile cer explicit o adresă validă; adresele deja salvate și identitatea conturilor nu pot fi redirecționate. Instalarea nu rescrie rezervări și nu trimite notificări istorice. Pentru o bază deja la 039 se aplică numai 040.


- **041:** separă identitatea istorică a contului de legătura Auth care poate deveni NULL la ștergere. Abaterile unui cont șters nu se adună la cele ale unui oaspete cu același email; notificările pentru contul șters nu sunt redirecționate către acel oaspete. Se păstrează UUID-urile dovedite de rezervări sau evenimente existente, fără asociere dedusă din adresa de email. Identitățile deja pierdute și fără dovezi nu pot fi reconstruite automat.
- **042:** recalcularea stării unui grup de rezervare este serializată înaintea citirii orelor. Două anulări simultane nu mai pot lăsa grupul „anulat parțial” după anularea tuturor orelor. Instalarea nu modifică rezervări, prețuri sau emailuri existente.

Funcțiile Edge `booking-workflow`, `club-applications` și `booking-notifications` trebuie publicate separat cu toate importurile locale, inclusiv `_shared/email-address.ts` și, unde este folosit, `_shared/public-rate-limit.ts`. `verify_jwt=false` se păstrează pentru handler-ele care verifică explicit sesiunea sau autorizarea serviciului. Nu introduce chei de serviciu în frontend.

## Restricționarea unui client

În administrare, deschide **Anulări târzii / neprezentări**. De la 3 abateri vizibile în aria administrată, cardul clientului permite alegerea duratei de **3, 7, 14 sau 30 de zile**, ori **Permanentă**. Decizia necesită confirmare și poate avea o notă internă. Nu există blocare automată.

Superadminul poate selecta aplicarea generală; administratorul obișnuit nu poate bloca rezervările la terenurile altcuiva. Restricțiile active pot fi ridicate din același panou. Expirarea temporară este verificată pe server. Mutarea unei rezervări la alt interval nu ocolește o restricție activă.

Restricțiile conturilor sunt legate de identitatea Auth. Pentru rezervările fără cont, serverul verifică și contactele curente corespunzătoare; un contact anonim inventat nu poate fi identificat cu certitudine ca aceeași persoană. O rezervare de oaspete nu poate crea singură o restricție pentru un cont verificat al altcuiva.

## Interfață, imagini și SEO

- Fotografiile terenurilor sunt decodate înainte de upload. Un fișier corupt, chiar declarat JPG/PNG, nu mai poate înlocui fotografia existentă; URL-ul temporar este eliberat, iar identitatea se verifică din nou după decodare.
- Confirmarea întârziată a unei rezervări nu închide alt teren sau altă zi deschisă între timp. Reîncercarea unei rezervări cu rezultat incert păstrează cererea inițială și contextul nou al interfeței.
- Un link de anulare permite reîncercarea explicită a previzualizării după erori temporare, înainte de confirmarea anulării. Tokenul rămâne în memorie și este eliminat din adresă și la închiderea dialogului.
- Previzualizările de anunț expirate sau cu destinatari schimbați pot fi refăcute explicit cu o aprobare nouă; campaniile deja aprobate ori cu răspuns incert păstrează identificatorul pentru a preveni dublurile.
- Resetarea parolei blochează cererile duble inclusiv din tastatură și redevine disponibilă după o eroare a serviciului Auth.
- Refuzul sau umplerea `localStorage` nu mai întrerupe inițializarea aplicației. Limba revine sigur la o valoare acceptată.
- Istoricul deschis al clientului și statusurile din istoricul administratorului se actualizează la expirarea rezervării din datele deja încărcate, fără polling suplimentar al bazei de date. Timerul se oprește la închidere, ascundere sau deconectare. În administrare se păstrează controalele și ciornele pentru prezență.
- Reîmprospătarea disponibilității păstrează orele selectate sau deselectate explicit; ora filtrului se aplică numai la inițializarea zilei/terenului, fără a adăuga ulterior o oră taxată.
- Refuzul unei rezervări din cauza unei restricții este explicat în română, maghiară și engleză. Nu se expun detalii private ale bazei de date și se păstrează protecția împotriva dublurilor după un răspuns incert.
- Rezultatele din căutarea terenurilor sunt accesibile prin Tab, Shift+Tab și Enter; dialogul păstrează focusul în interior.
- Resursele inițiale de brand folosesc `spotivity-32.png`, `spotivity-96.png` și `spotivity-256.webp`. Originalul rămâne disponibil pentru referințe vechi și imaginea de partajare, dar nu este folosit ca logo/fotografie implicită încărcată inițial. Antetul emailurilor folosește aceeași siglă de 96 px, aproximativ 16 KB, în locul originalului de 2 MB.
- La salvarea nereușită a unei fotografii noi se încearcă recuperarea obiectului încărcat. Înlocuirile confirmate curăță vechiul obiect numai dacă nu mai este referit. O confirmare pierdută nu permite ștergerea unei fotografii deja salvate în teren. Eșecurile de rețea sau de autorizare la cleanup nu șterg alte imagini și nu maschează eroarea originală.
- `scripts/seo-route-history.json` păstrează identitatea adreselor deja generate. Redenumirile și mutările generează aliasuri directe spre ruta curentă; GitHub Pages primește fallback HTML și redirect extern compatibil CSP, iar buildul Netlify produce reguli 301 pentru o publicare viitoare. Entitățile retrase nu sunt prezentate ca active.

## Emailuri și limita Make

Nu este necesar un al treilea scenariu activ. Scenariul central **7938404** primește rezervările, anulările, prezența/neprezentarea, bun venitul, chatul și anunțurile din panoul superadminului. Destinatarul și conținutul sunt verificate și generate pe server. Ruta de notificări păstrează procesarea secvențială, confidențialitatea și registrul de deduplicare; nu adaugă CC/BCC.

`scripts/make-chat.mjs` este transformarea pură, testată, care adaugă tipurile `chat_owner` și `chat_client` la ruta existentă. Nu conține webhookuri sau credențiale și nu face apeluri de provider. Destinația de chat din configurația privată Supabase se aliniază cu webhookul central după verificarea blueprintului. Scenariul vechi de chat poate rămâne oprit. Scenariile manuale vechi nu trebuie confundate cu trimiterea din panoul superadminului.

Un răspuns acceptat de Make nu garantează livrarea în inbox. Nu relua manual execuția direct de la Gmail după un rezultat incert; verifică mai întâi starea din registrul privat de livrări.

## Verificare

Testele folosesc PostgreSQL temporar, Chromium și transporturi simulate. Acoperă rolurile/scopurile, restricțiile și expirarea lor, anulările manuale, validarea emailurilor, curățarea sigură a imaginilor, storage indisponibil, istoricul, aliasurile și fluxurile obișnuite de rezervare/admin.

Înainte de push:

```bash
node --test scripts/tests/*.test.mjs
node scripts/generate-seo-pages.mjs --check
node scripts/build-public.mjs
```

Testele SQL suplimentare sunt în `supabase/tests/{manual-booking-cancellations,client-restrictions,guest-email-validation,court-photo-cleanup,legacy-attendance-email,durable-booking-customer-identity}.test.cjs`; variantele de ID numeric se rulează cu `SPOTIVITY_TEST_INTEGER_IDS=1`. Testele de browser corespunzătoare și `public-resilience-browser.test.cjs` nu modifică proiectul real. Pentru actualizarea catalogului și regenerarea adreselor, urmează `scripts/SEO_PAGES.md` și păstrează fișierul de istoric în Git.

Verificarea concurenței folosește două sesiuni PostgreSQL reale, cu administratori diferiți, într-un container temporar fără rețea. Nu accesează Supabase live și nu trimite emailuri. Necesită Docker local și imaginea `postgres:17` deja disponibilă:

```bash
python "Idee Site/supabase/tests/booking-state-concurrency.test.py"
```

Fixture-ul comun de browser verifică acum că migrarea cerută este instalată efectiv; o versiune acceptată nu mai este omisă de un filtru vechi de nume de fișiere.
