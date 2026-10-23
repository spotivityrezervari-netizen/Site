# Dezvoltare locală

Migrările 013–017 sunt aplicate și verificate în proiectul live, iar funcțiile Edge pentru rezervări și notificări sunt active. Publicarea fișierelor statice nu execută SQL. Notificările și rezervările fără cont se activează numai după configurarea și verificarea scenariilor Make.

Administrarea se face exclusiv în `index.html`, cu sesiunea site-ului. Administratorii obișnuiți intră automat în **Terenurile tale**, o pagină principală cu sporturile și terenurile alocate, inclusiv cele ascunse clienților. Meniul cu trei linii oferă profilul, editarea bazei, chat, rezervare manuală, program, istoric și **Administrare baze de date**, care deschide panoul complet existent. Superadminul folosește **Profilul meu → Deschide panoul de admin**. Pagina separată `admin.html` a fost eliminată.

Fotografia rotundă a bazei este separată de copertă. Migrarea `017_base_avatars.sql` a fost aplicată și verificată live pe 22 octombrie 2026, după o probă închisă cu rollback și comparații ale datelor și protecțiilor existente. Editorul fotografiei de profil este activ pentru administratorii cu permisiune explicită asupra bazei. Până la încărcarea unei fotografii sunt afișate inițialele bazei; coperțile existente sunt păstrate.

Site-ul din `Idee Site/` folosește HTML, CSS și JavaScript, cu un backend găzduit în Supabase. Nu are o etapă de build sau dependențe de instalat pentru a porni serverul local.

## Pornire

Din folderul `Idee Site`, cu Python 3 disponibil:

```bash
bash scripts/start-site.sh
```

Serverul servește `index.html`, inclusiv administrarea integrată, pe portul 8000, doar pe interfața locală. Oprește-l cu Ctrl+C. Pentru alt port:

```bash
PORT=8001 bash scripts/start-site.sh
```

Procesele trebuie repornite în fiecare mediu nou. Folosește checkout-ul existent; creează un worktree doar dacă este cerut explicit.

## Organizarea codului

`js/app.js` și `js/admin.js` sunt puncte mici de inițializare. Logica pentru autentificare, profil, terenuri, rezervări, istoric și chat este separată în `js/modules/`, cu module distincte pentru administrare. Contextul comun și metodele serviciilor păstrează sincronizarea sesiunii; API-urile și evenimentele existente rămân compatibile. Toată interfața rămâne în `index.html`, fără o etapă nouă de build sau modificări Supabase. Harta fișierelor și contractele sunt în [js/README.md](js/README.md).

## Verificare

Verifică sintaxa fișierelor JavaScript:

```bash
for f in js/*.js js/modules/*.js; do node --check "$f" || exit; done
```

Cu serverul pornit, rulează verificările în browser:

```bash
node scripts/smoke-site.cjs
```

Acest script necesită Node.js, Playwright și Chromium. Acestea sunt deja disponibile în mediul cloud pregătit. Scriptul folosește implicit `/usr/bin/chromium`; poți indica alt executabil prin `CHROMIUM_PATH`. Pentru serverul pornit pe alt port:

```bash
SITE_BASE_URL=http://127.0.0.1:8001/ node scripts/smoke-site.cjs
```

Verificările acoperă pagina principală cu administrarea integrată, imaginile, cele cinci dialoguri pentru sporturi, dialogul de autentificare pe desktop și mobil, erorile JavaScript și o citire din Supabase. Scriptul blochează cererile de scriere; nu creează conturi sau rezervări și nu verifică operațiunile autentificate. Orice verificare obligatorie nereușită, inclusiv citirea din Supabase, produce un cod de ieșire diferit de zero.

## Acces de rețea în mediul cloud

Sunt necesare conexiuni HTTPS către:

- `cdn.jsdelivr.net`, pentru SDK-ul Supabase;
- `ndubcdwohqzgxpuiowye.supabase.co`, pentru backend-ul existent.

Lista de domenii permise se configurează în setările mediului cloud; acest fișier nu aplică acele setări. Permisiunea pentru Supabase a fost salvată în draft. În verificarea curentă au trecut atât verificările locale, cât și încărcarea imaginilor găzduite și citirea din Supabase, cu HTTP 200. Rulează din nou verificările în fiecare mediu nou; rezultatul curent nu confirmă publicarea sau restaurarea mediului.

Scriptul reutilizează proxy-ul HTTPS al mediului și păstrează verificarea certificatelor TLS. Dacă Chromium raportează `ERR_CERT_AUTHORITY_INVALID` în sandbox, verifică accesul la baza sa de certificate NSS. În mediul pregătit, certificatul CA al platformei era deja de încredere, iar verificările au funcționat prin rularea scriptului cu mecanismul de escaladare permis al instrumentului de execuție. Nu dezactiva verificarea TLS. Dacă accesul NSS al Chromium nu este disponibil, poți rula citirile reale prin transportul HTTPS validat al curl:

```bash
SPOTIVITY_SMOKE_TLS_TRANSPORT=curl SITE_BASE_URL=http://127.0.0.1:8004/ node scripts/smoke-site.cjs
```

Această opțiune păstrează răspunsurile reale, verifică SHA-384 al SDK-ului pinuit și lasă SRI activ în browser; blochează aceleași scrieri ca verificarea obișnuită.

Configurația publică Supabase este deja în codul site-ului. Nu adăuga credențiale private în scripturi sau documentație.

## Publicare și programul terenurilor

Site-ul folosit este [GitHub Pages](https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/). Superadminul folosește **Profilul meu → Deschide panoul de admin**, iar administratorii bazelor intră direct în administrarea alocărilor proprii, în aceeași pagină și sesiune. Publicarea servește fișierele statice din `main`. Verifică ultimul deployment `github-pages` după actualizare.

Programul rezervabil se schimbă în setările fiecărui teren din admin: ore de început 09:00–22:00. Terenurile existente păstrează 12:00–22:00 până le modifici. Migrarea `supabase/003_court_hours.sql` este aplicată în proiectul existent; [instrucțiunile Supabase](supabase/README.md) explică pașii, rolurile și verificările. Nu rula din nou migrarea 001 după 003.


## Baze sportive și istoricul rezervărilor

Din pagina principală, butonul **Vezi bazele sportive** (sau **Baze sportive** pe telefon) deschide lista pentru orașul ales. Fiecare bază are descriere, terenuri și buton **Distribuie**. Rezervarea folosește formularul existent.

Din **Profilul meu → Deschide panoul de admin**, superadminul deschide **Baze sportive** pentru a crea o bază sau a-i modifica numele, orașul, descrierea și terenurile. Bifează terenurile existente, apoi apasă **Salvează baza**. Pentru un teren nou, folosește **Adaugă Teren → Baza sportivă**. Pentru mutarea unui teren, scoate-l întâi din baza veche și salvează. O bază fără terenuri active nu apare public.

În aceeași fereastră, **Cine poate edita descrierea și fotografia** acordă explicit acces unui administrator. Acest acces permite descrierea și fotografia bazei; nu extinde accesul la rezervări, clienți sau alte terenuri. Superadminul are acces la toate bazele.

Rezervările finalizate rămân în istoric fără buton de anulare. O rezervare pe o oră se încheie la sfârșitul acelei ore: pentru 10:00, limita este 11:00, în fusul Europe/Bucharest. Rezervările viitoare și cele în desfășurare se pot anula conform permisiunilor existente. Regula este verificată și de baza de date, pentru client, admin și superadmin.

Migrările aferente sunt `supabase/006_sports_bases.sql` și `supabase/007_completed_booking_cancellation.sql`; nu rula fișierele din `supabase/tests/` în proiectul real.

## Căutare globală și terenuri pe pagina principală

Navigarea conține **Caută un teren**: caută după nume, sport sau oraș, fără să limiteze rezultatele la orașul ales. Diacriticele nu sunt obligatorii. Sunt afișate numai terenurile active accesibile public; încărcarea este paginată. Un card deschide formularul existent, care verifică din nou terenul prin Supabase.

Fiecare sport are un singur buton **Rezervă un teren** și o listă de carduri mici cu scroll lateral pentru orașul selectat. Tenisul de picior are secțiune proprie, cu aceleași filtre, carduri și flux de rezervare ca celelalte sporturi. **Baze sportive** are o secțiune separată cu baze active care au terenuri active, filtrată după oraș.

În administrarea integrată, **Setări baze sportive** apare pentru adminii obișnuiți cu alocare explicită în `baze_sportive_admini`. Adminul obișnuit poate edita descrierea și fotografia bazelor alocate. Superadminul acordă acces din **Cine poate edita descrierea și fotografia** în panoul integrat; alocarea unui teren nu acordă automat acces la setările bazei. Nu se extind drepturile asupra rezervărilor sau altor terenuri.

Verificarea RLS în proiectul real a confirmat refuzul fără alocare, editarea numai a descrierii cu alocare și refuzul după retragerea dreptului. Proba s-a închis cu rollback, fără schimbări persistente în date sau permisiuni. Protecția migrării 007 pentru rezervările finalizate rămâne activă.

## Editarea profilului

Autentificarea Google este integrată în același dialog și folosește conturile și permisiunile Supabase existente. Butonul apare numai după configurarea providerului real; la verificarea din 22 octombrie 2026 lipseau Client ID și Client Secret. Activarea gratuită în Google Cloud și Supabase este descrisă în [GOOGLE_AUTH.md](GOOGLE_AUTH.md). Emailul și parola rămân disponibile.

Din **Profilul meu → Editează profilul**, poți modifica numele, telefonul și emailul. **Verifică modificările** afișează schimbările; abia **Confirmă și salvează** trimite cererile. Datele sunt validate și de Supabase: numele are 2–200 de caractere, iar telefonul 7–15 cifre și cel mult 50 de caractere de formatare.

Emailul se modifică prin Supabase Auth, cu **Secure email change** activ. Linkurile de confirmare se trimit la adresa actuală și la cea nouă. Până la confirmare, autentificarea și profilul folosesc adresa actuală. După confirmare, triggerul Auth sincronizează contactele, rezervările și chatul după UUID. Frontend-ul citește rezervările și chatul după același UUID, astfel încât schimbarea emailului să nu le ascundă.

Migrarea `supabase/008_profile_edit.sql`, aplicată după 007, permite numai editarea propriului nume și telefon și blochează modificarea directă a identității/emailului. Creează doar profilurile lipsă pentru conturi Auth vechi; păstrează rândurile existente și refuză coliziunile de email. Nu acordă roluri sau baze suplimentare. Nu reaplica 001 peste 008.

Pentru confirmări către clienți este necesar **SMTP propriu** în Supabase. Expeditorul implicit este destinat adreselor membrilor echipei proiectului. Configurarea SMTP se face securizat în Dashboard, conform [instrucțiunilor Supabase](https://supabase.com/docs/guides/auth/auth-smtp); nu include parola SMTP sau cheile în repository. `mailer_secure_email_change_enabled` trebuie să rămână activ. `mailer_autoconfirm` pentru înregistrări nu elimină confirmarea schimbării emailului conturilor permanente.

Verificările izolate noi sunt `supabase/tests/profile-edit.test.cjs` (cu și fără `SPOTIVITY_TEST_INTEGER_IDS=1`) și `supabase/tests/profile-edit-browser.test.cjs`. Testele browser folosesc SDK-ul real, PostgreSQL izolat și confirmări Auth simulate; nu trimit mesaje și nu schimbă conturi live.

## Tema neagră, căutare și fotografii — 15 octombrie 2026

Pagina publică folosește tema neagră cu accente gold și tranziții discrete între sporturi. Pe telefon, câmpul de căutare ocupă spațiul dintre logo și meniu; scrie numele, sportul sau orașul și apasă Enter ori lupa. Căutarea rămâne globală, indiferent de orașul selectat. Profilul este primul în meniul mobil.

Rândurile de terenuri care depășesc lățimea disponibilă se derulează automat, lent, în ambele sensuri, cu accelerare și încetinire graduală. Nu au butoane de pornire/oprire. Hoverul, focusul, atingerea, derularea manuală și formularele deschise o suspendă; preferința sistemului pentru mișcare redusă dezactivează animațiile. Secțiunile apar gradual, cu fundaluri care se îmbină lin. Cardurile existente și formularul de rezervare sunt păstrate.

În **Admin → Setări baze sportive → selectează baza → Fotografia bazei sportive**, alege un JPG, PNG, WebP, AVIF sau GIF de maximum 5 MB și apasă **Salvează fotografia**. Poți înlocui sau elimina fotografia. Pentru o bază nouă, salvează întâi baza și redeschide setările. Fotografia se salvează separat de descriere și apare în secțiunea de pe prima pagină, în lista bazelor și în detaliile bazei.

Migrarea `supabase/009_base_photos.sql` este aplicată după 008 în proiectul existent. Adminii obișnuiți pot încărca fotografii numai pentru bazele cu permisiune explicită; superadminul poate gestiona toate bazele. Bucketul public `poze_baze_sportive` și coloana `baze_sportive.poza` păstrează o cale de forma `UUID-bază/UUID-imagine.ext`. RLS verifică permisiunile curente, inclusiv după revocare; descrierile, terenurile și rezervările existente sunt păstrate.

Testele noi sunt `supabase/tests/base-photos.test.cjs` (UUID și ID numeric) și `supabase/tests/discovery-media-browser.test.cjs`. Folosesc numai date izolate; nu încarcă fotografii în proiectul real.


## Înscrierea bazelor sportive

Secțiunea **Înscrie-ți baza sportivă** este disponibilă și fără conectare. Solicitantul completează baza/clubul, persoana de contact, orașul, emailul, telefonul, adresa opțională, linkul Google Maps, 1–20 de terenuri cu sportul și tariful întreg în lei/oră, descrierea și o fotografie opțională. Alege o parolă și o confirmă; dacă emailul are deja cont, trebuie să folosească parola acelui cont. Parola ajunge numai în Supabase Auth, fără să fie salvată în cerere, afișată superadminului sau păstrată în stocarea browserului. Trimiterea nu conectează automat browserul și nu acordă acces admin.

În panoul deschis din **Profilul meu → Deschide panoul de admin**, numai superadminul are meniul **Cereri înscriere baze**. **Acceptă și publică** cere confirmare și tarifele fiecărui teren, creează atomic baza și terenurile active și acordă solicitantului acces de admin obișnuit doar pentru acestea. Permisiunile anterioare se păstrează. **Respinge cererea** nu creează resurse sau roluri. Notele interne și stările de lucru rămân disponibile; o cerere publicată nu poate fi respinsă ulterior din acest meniu. Solicitantul se conectează în site-ul principal cu emailul și parola alese și deschide **Profilul meu → Administrează baza sportivă** după aprobare. Emailul contului trebuie confirmat în Auth înainte de aprobare, dacă proiectul cere confirmarea la înscriere.

Fluxul folosește migrările `supabase/011_club_requests.sql`, `supabase/012_club_approval.sql` și Edge Function `supabase/functions/club-applications`. Funcția primește cererea anonimă, verifică sau creează contul prin Auth și folosește un RPC rezervat serverului. Acceptarea/respingerea verifică JWT-ul și rolul actual de superadmin și apelează RPC-urile cu identitatea acestuia. Cheia `service_role` există numai în mediul Edge; nu se pune în site sau în repository.

Cererile și fotografiile depuse sunt private prin RLS. La acceptare, fotografia este copiată în bucketul public al bazei; la respingere rămâne privată. Reîncercarea după pierderea confirmării folosește același UUID fără dublarea cererii, bazei sau terenurilor. Limita existentă de cinci cereri pe cont în 24 de ore rămâne activă.

## Administrarea bazelor în site

După verificarea drepturilor reale prin `get_admin_access()`, administratorul obișnuit intră automat în **Terenurile tale**. Pagina păstrează tema și fundalurile sporturilor din aplicație și citește detaliile numai pentru ID-urile alocate. Cardurile deschid direct setările, chatul terenului și rezervarea manuală, iar fiecare sport are acces la program. Antetul are profilul și meniul cu trei linii; profilul administratorului nu afișează butonul de editare a contului. Clienții își păstrează editorul de profil.

**Administrare baze de date**, din meniu sau profil, deschide întregul panou existent. **Înapoi la terenurile mele** revine la pagina proprie. **Vezi site-ul**, din meniu, deschide temporar catalogul public în aceeași sesiune și recitește datele. Reîncărcarea sau o conectare nouă deschide pagina proprie. O întrerupere temporară a verificării permisiunilor ascunde datele private și oferă reîncercare; retragerea drepturilor sau deconectarea restabilește catalogul public. Superadminul păstrează panoul global, inclusiv cererile de înscriere, acceptarea/respingerea și gestionarea administratorilor.

Butonul **+** de pe un teren sau **Adaugă teren** din baza proprie creează un teren nou numai în acea bază, cu nume, sport, tarif și ore rezervabile. Este disponibil numai cu permisiune explicită asupra bazei. Migrarea `019_owner_court_creation.sql` validează identitatea și permisiunea curentă, creează terenul și îi acordă creatorului acces numai la acesta, atomic. Permisiunea asupra unei baze nu acordă acces la terenurile altor administratori. Inserarea directă prin REST rămâne rezervată superadminului. Dacă același sport există în mai multe baze, folosește plusul cardului sau al bazei pentru o destinație explicită.

Alege baza din selector. Sunt afișate numai terenurile alocate explicit în `users_admin.terenuri`, inclusiv cele momentan ascunse. Terenurile alocate fără bază apar într-o opțiune separată. Rezervările manuale, programul/blocajele, tarifele, fotografiile terenurilor, istoricul și chatul folosesc aceleași formulare ca înainte. **Setări baze sportive** permite descrierea și fotografia numai cu alocarea explicită `baze_sportive_admini`; simpla alocare a unui teren nu acordă acel drept, iar alocarea bazei nu extinde accesul la celelalte terenuri.

După aprobarea unei cereri, accesul este actualizat fără reconectare la deschiderea profilului, revenirea în filă sau următoarea verificare automată (maximum 30 de secunde cât fila este vizibilă); administratorul este trecut direct în administrarea proprie. Retragerea permisiunilor este verificată imediat de Supabase la fiecare operațiune; verificarea interfeței ascunde și curăță ecranele la actualizarea accesului. Migrarea 013 păstrează datele și alocările, adaugă limite RLS restrictive și interzice și ștergerea sau mutarea în viitor a unei rezervări finalizate pentru a o anula ulterior.

Fiecare bază are o copertă și o fotografie de profil rotundă. Administratorii cu permisiune explicită de editare a bazei le pot modifica separat din **Editează baza sportivă → Fotografia de profil a bazei**; simpla alocare a unui teren nu acordă acest drept. Sunt acceptate imagini raster de maximum 5 MB. Încărcarea, înlocuirea și eliminarea verifică sesiunea și permisiunile curente; curățarea fișierelor verifică ambele referințe, astfel încât o imagine încă folosită ca profil sau copertă să fie păstrată. Lipsa fotografiei afișează inițialele bazei în cerc. Migrarea 017, aplicată live, păstrează rezervările, rolurile, alocările și politicile Storage existente.

Verificări izolate, fără scrieri în proiectul real:

```bash
node supabase/tests/admin-integration.test.cjs
SPOTIVITY_TEST_INTEGER_IDS=1 node supabase/tests/admin-integration.test.cjs
SITE_BASE_URL=http://127.0.0.1:8010/ node supabase/tests/integrated-admin-browser.test.cjs
```


## Rezervări consecutive, oaspeți și administrare în aceeași pagină

O persoană poate crea o singură rezervare activă la același sport și în aceeași zi, indiferent de teren sau oraș. O rezervare poate conține mai multe ore consecutive pe același teren. Serverul aplică regula după UUID-ul contului, emailul normalizat și telefonul normalizat (07…, +407… și 00407… sunt echivalente). Rezervările istorice și operațiunile manuale autorizate ale personalului sunt păstrate. Anularea eliberează orele nefinalizate; nu șterge istoricul și nu poate anula ore finalizate.

Fără conectare, formularul cere numele, emailul și telefonul. Nu cere parolă și nu creează un cont Auth. Confirmarea prin Make include un link privat de anulare. Deschiderea linkului arată o verificare; numai apăsarea explicită a butonului anulează orele nefinalizate. Tokenul este păstrat în URL numai ca fragment, eliminat imediat din adresă, și în baza de date numai sub formă de SHA-256. Retrimiterea unei cereri cu răspuns incert păstrează același UUID, fără dublare. Până când Make este configurat și verificat, rezervările fără cont sunt refuzate înainte de creare, pentru a nu lăsa un client fără confirmare și link de anulare.

Administratorii bazelor au terenurile direct sub fiecare sport, cu **Editează** și **Program [sport]**, și editarea descrierii/fotografiei bazei. Superadminul deschide panoul complet din profil în aceeași pagină, cu sesiunea existentă. Calendarul de administrare acceptă date valide din anii 0001–9999; această consultare nu schimbă fereastra de rezervare a clienților. Listele implicite ascund rezervările după 30 de zile de la încheiere; datele rămân în Supabase și sunt accesibile prin calendarul explicit.

Telefonul salvat în profil are prioritate. Migrarea 015 recuperează numai telefoanele lipsă din propriile metadate Auth sau cereri de bază cu UUID și email identice; nu inventează numere și nu înlocuiește datele deja editate.

Emailurile sunt gestionate de un outbox privat: confirmare/anulare către client și proprietarul autorizat, plus notificarea proprietarului pentru mesaje noi ale clientului. Joburile revalidează permisiunile înainte de trimitere și folosesc identificatori stabili pentru deduplicare în Make. `submitted` indică acceptarea webhookului de către Make, nu dovada livrării în inbox. Detaliile configurării sunt în `supabase/MAKE_NOTIFICATIONS.md`.
