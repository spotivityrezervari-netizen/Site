# Dezvoltare locală

Site-ul din `Idee Site/` folosește HTML, CSS și JavaScript, cu un backend găzduit în Supabase. Nu are o etapă de build sau dependențe de instalat pentru a porni serverul local.

## Pornire

Din folderul `Idee Site`, cu Python 3 disponibil:

```bash
bash scripts/start-site.sh
```

Serverul servește `index.html` și `admin.html` pe portul 8000, doar pe interfața locală. Oprește-l cu Ctrl+C. Pentru alt port:

```bash
PORT=8001 bash scripts/start-site.sh
```

Procesele trebuie repornite în fiecare mediu nou. Folosește checkout-ul existent; creează un worktree doar dacă este cerut explicit.

## Verificare

Verifică sintaxa fișierelor JavaScript:

```bash
for f in js/*.js; do node --check "$f" || exit; done
```

Cu serverul pornit, rulează verificările în browser:

```bash
node scripts/smoke-site.cjs
```

Acest script necesită Node.js, Playwright și Chromium. Acestea sunt deja disponibile în mediul cloud pregătit. Scriptul folosește implicit `/usr/bin/chromium`; poți indica alt executabil prin `CHROMIUM_PATH`. Pentru serverul pornit pe alt port:

```bash
SITE_BASE_URL=http://127.0.0.1:8001/ node scripts/smoke-site.cjs
```

Verificările acoperă paginile publică și admin, imaginile, cele patru dialoguri pentru sporturi, dialogul de autentificare pe desktop și mobil, erorile JavaScript și o citire din Supabase. Scriptul blochează cererile de scriere; nu creează conturi sau rezervări și nu verifică operațiunile autentificate. Orice verificare obligatorie nereușită, inclusiv citirea din Supabase, produce un cod de ieșire diferit de zero.

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

Site-ul folosit este [GitHub Pages](https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/), cu panoul [admin.html](https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/admin.html). Publicarea servește fișierele statice din `main`. Verifică ultimul deployment `github-pages` după actualizare.

Programul rezervabil se schimbă în setările fiecărui teren din admin: ore de început 09:00–22:00. Terenurile existente păstrează 12:00–22:00 până le modifici. Migrarea `supabase/003_court_hours.sql` este aplicată în proiectul existent; [instrucțiunile Supabase](supabase/README.md) explică pașii, rolurile și verificările. Nu rula din nou migrarea 001 după 003.


## Baze sportive și istoricul rezervărilor

Din pagina principală, butonul **Vezi bazele sportive** (sau **Baze sportive** pe telefon) deschide lista pentru orașul ales. Fiecare bază are descriere, terenuri și buton **Distribuie**. Rezervarea folosește formularul existent.

În `admin.html`, superadminul deschide **Baze sportive** pentru a crea o bază sau a-i modifica numele, orașul, descrierea și terenurile. Bifează terenurile existente, apoi apasă **Salvează baza**. Pentru un teren nou, folosește **Adaugă Teren → Baza sportivă**. Pentru mutarea unui teren, scoate-l întâi din baza veche și salvează. O bază fără terenuri active nu apare public.

În aceeași fereastră, **Cine poate edita descrierea și fotografia** acordă explicit acces unui administrator. Acest acces permite descrierea și fotografia bazei; nu extinde accesul la rezervări, clienți sau alte terenuri. Superadminul are acces la toate bazele.

Rezervările finalizate rămân în istoric fără buton de anulare. O rezervare pe o oră se încheie la sfârșitul acelei ore: pentru 10:00, limita este 11:00, în fusul Europe/Bucharest. Rezervările viitoare și cele în desfășurare se pot anula conform permisiunilor existente. Regula este verificată și de baza de date, pentru client, admin și superadmin.

Migrările aferente sunt `supabase/006_sports_bases.sql` și `supabase/007_completed_booking_cancellation.sql`; nu rula fișierele din `supabase/tests/` în proiectul real.

## Căutare globală și terenuri pe pagina principală

Navigarea conține **Caută un teren**: caută după nume, sport sau oraș, fără să limiteze rezultatele la orașul ales. Diacriticele nu sunt obligatorii. Sunt afișate numai terenurile active accesibile public; încărcarea este paginată. Un card deschide formularul existent, care verifică din nou terenul prin Supabase.

Fiecare sport are un singur buton **Rezervă un teren** și o listă de carduri mici cu scroll lateral pentru orașul selectat. Tenisul de picior rămâne în secțiunea Fotbal. **Baze sportive** are o secțiune separată cu baze active care au terenuri active, filtrată după oraș.

În admin, **Setări baze sportive** apare pentru superadmin și pentru adminii obișnuiți cu alocare explicită în `baze_sportive_admini`. Adminul obișnuit poate edita descrierea și fotografia bazelor alocate. Superadminul acordă acces din **Cine poate edita descrierea și fotografia**; alocarea unui teren nu acordă automat acces la setările bazei. Nu se extind drepturile asupra rezervărilor sau altor terenuri.

Verificarea RLS în proiectul real a confirmat refuzul fără alocare, editarea numai a descrierii cu alocare și refuzul după retragerea dreptului. Proba s-a închis cu rollback, fără schimbări persistente în date sau permisiuni. Protecția migrării 007 pentru rezervările finalizate rămâne activă.

## Editarea profilului

Din **Profilul meu → Editează profilul**, poți modifica numele, telefonul și emailul. **Verifică modificările** afișează schimbările; abia **Confirmă și salvează** trimite cererile. Datele sunt validate și de Supabase: numele are 2–200 de caractere, iar telefonul 7–15 cifre și cel mult 50 de caractere de formatare.

Emailul se modifică prin Supabase Auth, cu **Secure email change** activ. Linkurile de confirmare se trimit la adresa actuală și la cea nouă. Până la confirmare, autentificarea și profilul folosesc adresa actuală. După confirmare, triggerul Auth sincronizează contactele, rezervările și chatul după UUID. Frontend-ul citește rezervările și chatul după același UUID, astfel încât schimbarea emailului să nu le ascundă.

Migrarea `supabase/008_profile_edit.sql`, aplicată după 007, permite numai editarea propriului nume și telefon și blochează modificarea directă a identității/emailului. Creează doar profilurile lipsă pentru conturi Auth vechi; păstrează rândurile existente și refuză coliziunile de email. Nu acordă roluri sau baze suplimentare. Nu reaplica 001 peste 008.

Pentru confirmări către clienți este necesar **SMTP propriu** în Supabase. Expeditorul implicit este destinat adreselor membrilor echipei proiectului. Configurarea SMTP se face securizat în Dashboard, conform [instrucțiunilor Supabase](https://supabase.com/docs/guides/auth/auth-smtp); nu include parola SMTP sau cheile în repository. `mailer_secure_email_change_enabled` trebuie să rămână activ. `mailer_autoconfirm` pentru înregistrări nu elimină confirmarea schimbării emailului conturilor permanente.

Verificările izolate noi sunt `supabase/tests/profile-edit.test.cjs` (cu și fără `SPOTIVITY_TEST_INTEGER_IDS=1`) și `supabase/tests/profile-edit-browser.test.cjs`. Testele browser folosesc SDK-ul real, PostgreSQL izolat și confirmări Auth simulate; nu trimit mesaje și nu schimbă conturi live.

## Tema luminoasă, căutare și fotografii — 15 octombrie 2026

Pagina publică folosește crem, accente gold și fundaluri pastel pentru fiecare sport. Pe telefon, câmpul de căutare ocupă spațiul dintre logo și meniu; scrie numele, sportul sau orașul și apasă Enter ori lupa. Căutarea rămâne globală, indiferent de orașul selectat. Profilul este primul în meniul mobil.

Rândurile de terenuri care depășesc lățimea disponibilă se derulează automat, lent, în ambele sensuri. Butonul **Pauză derulare** oprește mișcarea. Hoverul, focusul, atingerea, derularea manuală și formularele deschise o suspendă; preferința sistemului pentru mișcare redusă dezactivează animațiile. Secțiunile apar gradual, cu fundaluri care se îmbină lin. Cardurile existente și formularul de rezervare sunt păstrate.

În **Admin → Setări baze sportive → selectează baza → Fotografia bazei sportive**, alege un JPG, PNG, WebP, AVIF sau GIF de maximum 5 MB și apasă **Salvează fotografia**. Poți înlocui sau elimina fotografia. Pentru o bază nouă, salvează întâi baza și redeschide setările. Fotografia se salvează separat de descriere și apare în secțiunea de pe prima pagină, în lista bazelor și în detaliile bazei.

Migrarea `supabase/009_base_photos.sql` este aplicată după 008 în proiectul existent. Adminii obișnuiți pot încărca fotografii numai pentru bazele cu permisiune explicită; superadminul poate gestiona toate bazele. Bucketul public `poze_baze_sportive` și coloana `baze_sportive.poza` păstrează o cale de forma `UUID-bază/UUID-imagine.ext`. RLS verifică permisiunile curente, inclusiv după revocare; descrierile, terenurile și rezervările existente sunt păstrate.

Testele noi sunt `supabase/tests/base-photos.test.cjs` (UUID și ID numeric) și `supabase/tests/discovery-media-browser.test.cjs`. Folosesc numai date izolate; nu încarcă fotografii în proiectul real.
