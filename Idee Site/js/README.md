# Organizarea JavaScript

Toată interfața publică și administrarea rămân în `index.html`. Nu există o pagină separată de admin sau un bundler. Buildul de publicare `node scripts/build-public.mjs`, din rădăcina repository-ului, copiază numai fișierele frontend aprobate în `dist/`; nu transformă modulele și nu ascunde JavaScript-ul din browser. La adăugarea unui fișier runtime, actualizează și `scripts/public-files.json`.

`app.js` și `admin.js` compun funcționalitățile din `modules/`. Fișierele din acel folder înregistrează fabrici în `window.SpotivityModules`; punctele de intrare le inițializează o singură dată, cu un context explicit. Sunt scripturi clasice cu `defer`, nu importuri ES modules. Ordinea lor din `index.html` este parte din inițializare.

## Interfața publică

| Fișier | Responsabilitate |
| --- | --- |
| `modules/public-i18n.js` | Traduceri, schimbarea limbii și formatarea datelor |
| `modules/public-recovery.js` | Sesiunea verificată pentru recuperarea parolei și dialogul de resetare |
| `modules/public-profile.js` | Citirea identității/profilului și deschiderea profilului |
| `modules/public-auth.js` | Conectare, înregistrare, deconectare, solicitarea resetării și evenimente Auth |
| `modules/public-ui.js` | Închiderea dialogurilor, scrollul și fundalurile sporturilor |
| `modules/public-courts.js` | Catalog, orașe, filtre și deschiderea unui teren |
| `modules/public-bookings.js` | Zile, ore consecutive, confirmare și disponibilitate în timp real |
| `modules/public-history.js` | Rezervări active, istoric și anulări |
| `modules/public-chat.js` | Conversațiile clientului, dreptul de a trimite și abonamentele Realtime |

Contextul public conține conexiunea Supabase, `state` și `services`. Identitatea, generația autentificării, catalogul și sportul curent sunt citite prin obiectul comun `state`. Selecția orelor și contoarele cererilor rămân private în modulele care le dețin. Modulele comunică prin metodele din `services`.

`app.js` instalează traducerile și recuperarea parolei înainte de `DOMContentLoaded`. La încărcarea documentului creează serviciile, încarcă terenurile, restaurează profilul, apoi conectează comenzile interfeței și urmărirea sesiunii. Capturarea inițială a evenimentului SDK de recuperare rămâne în `db.js`.

`google-auth.js` se încarcă sincron înainte de `db.js` pentru a reține erorile callbackului înainte de inițializarea SDK. La `DOMContentLoaded` folosește aceeași conexiune `db`, verifică providerul prin setările publice Auth și gestionează butonul, redirecționarea, traducerile și erorile Google. Nu salvează tokenuri sau roluri proprii. `db.js` folosește PKCE pentru linkurile noi și păstrează compatibilitatea cu vechile linkuri de recuperare care conțin tokenuri în hash. Pașii de activare sunt în [GOOGLE_AUTH.md](../GOOGLE_AUTH.md).

## Administrare

| Fișier | Responsabilitate |
| --- | --- |
| `modules/admin-core.js` | Starea sesiunii, invalidarea cererilor și curățarea interfeței |
| `modules/admin-court-view.js` | Afișarea panoului, orașelor, sporturilor și formularelor terenurilor |
| `modules/admin-courts.js` | Crearea/editarea/ștergerea terenurilor, fotografii și tarife |
| `modules/admin-allocations.js` | Crearea rolurilor și alocarea terenurilor angajaților |
| `modules/admin-schedule.js` | Calendar și afișarea disponibilității pentru data aleasă |
| `modules/admin-bookings.js` | Rezervări manuale, blocaje și anulări administrative |
| `modules/admin-history.js` | Listele de rezervări și exportul istoricului |
| `modules/admin-chat.js` | Conversațiile personalului și notificările Realtime |

`admin.js` creează contextul prin `adminCore`, instalează toate funcționalitățile și pornește ciclul sesiunii la final. Contextul comun păstrează contul și generațiile cererilor; `captureContext()` verifică dacă o operație asincronă mai aparține sesiunii inițiale. Chatul oferă explicit inițializarea, invalidarea și eliminarea abonamentelor sale.

## Module existente și contracte

`db.js`, `security.js` și `sport-appearance.js` rămân dependențele comune. `profile-editor.js`, `guest-booking.js`, `base-admin.js`, `admin-baze.js`, `admin-club-requests.js`, `club-registration.js` și fișierele pentru pagina principală își păstrează responsabilitățile existente.

`base-media.js` trebuie încărcat înaintea fișierelor `home.js`, `baze.js` și `home-discovery.js`. Oferă renderer-ele comune pentru copertă și fotografie rotundă, plus citirea compatibilă cu schema anterioară migrării 017. Doar lipsa explicită a coloanei `poza_profil` permite repetarea citirii fără ea; alte erori sunt păstrate. Fotografia de profil folosește exclusiv `poza_profil`, cu inițiale când lipsește sau imaginea nu poate fi încărcată.

`base-avatar-editor.js` se încarcă înainte de `admin-baze.js`. Controllerul comun gestionează independent câmpurile `poza` și `poza_profil`, validează imaginile și oprește operațiile după schimbarea contului, rolului sau bazei. Înainte de orice curățare Storage, recitește ambele referințe din baza autorizată. Operațiile de copertă și profil sunt serializate; un răspuns incert la salvare păstrează fișierul. Editorul profilului este activ numai dacă rândul citit conține coloana nouă.

`base-admin.js` verifică rolul prin server și hidratează numai ID-urile de terenuri alocate, inclusiv cele inactive. `owner-home.js` afișează pagina implicită **Terenurile tale**, fără cereri către catalogul global; primește `{userId, access, courts, active, loading, error}` prin `renderSpotivityOwnerHome()`. Deduplică actualizările identice pentru a păstra focusul și meniul. Acțiunile trec prin `openSpotivityOwnerHomeAction()`, care verifică din nou accesul și pregătește contextul existent: toate terenurile pentru acțiunile globale, terenul exact pentru chatul unui card. Setările, programul și rezervarea manuală folosesc aceleași module și se deschid peste pagina proprie. Prezentarea paginii proprii reutilizează clasele `home-*` ale clientului; fiecare sport cu terenuri alocate are un rând orizontal și un card de creare primul, cu aceleași dimensiuni. Căutarea locală și alegerea bazei folosesc dialoguri proprii, fără cereri către catalogul public. Clasele `owner-home-menu-open` și `owner-home-dialog-open` suspendă animațiile comune din `home-motion.js`, care urmărește atât pagina publică, cât și `owner-home`.

**Administrare baze de date** verifică accesul și deschide pagina nouă **Terenurile tale** pentru administratorii obișnuiți, inclusiv la intrarea din contul de pe site-ul public. Panoul global rămâne intrarea superadminului. Integrările modulelor comune pot deschide explicit panoul prin `openSpotivityAdminWorkspace()`, cu aceleași verificări de acces; butoanele administratorului obișnuit nu folosesc această intrare. **Înapoi la terenurile mele** revine în pagină. **Vezi site-ul** păstrează doar în memorie o vizualizare publică temporară. Logout-ul, schimbarea identității sau retragerea accesului curăță datele; o eroare de verificare păstrează numai pagina goală de reîncercare. `openSpotivityProfile({guard})` verifică și generația navigării înainte de a deschide profilul după citiri asincrone. Administratorul obișnuit nu are buton de profil în antet sau în meniu; acțiunea `profile` a paginii proprii este refuzată. Profilurile clienților și fluxul superadminului rămân disponibile, fără schimbarea RLS a profilului.

`owner-court-create.js` gestionează formularul **Adaugă teren** și RPC-ul îngust `create_managed_court`, după migrarea 019. Operația este legată de sesiunea verificată inițială, cu un client Auth separat fără persistență. Verifică din nou permisiunea explicită asupra bazei și invalidează formularul la schimbarea contului, rolului sau bazei. Salvarea reușită recitește accesul înainte de `spotivity:owner-court-created`; browserul nu actualizează roluri sau alocări direct.

Înainte de revenire, controller-ele `closeSpotivityHomeMenu()`, `closeSportsBases()`, `closeCourtSearch()` și `closeSpotivityPublicCourts()` închid dialogurile și invalidează cererile/formularele publice, fără a anula rezervări. Astfel, starea `inert` este restaurată corect și o citire întârziată nu poate redeschide un formular peste panou. La intrarea în site, `refreshSpotivityPublicCatalog()` recitește terenurile și orașele, păstrează orașul selectat dacă este încă valid și apelează `refreshSpotivityDiscovery()` pentru carduri, prețuri și fotografii actuale. Continuările verifică generația și identitatea Auth.

Restaurarea profilului verifică din nou sesiunea după citirea datelor; un logout în timpul încărcării nu poate restaura identitatea veche. Urmărirea Auth reconciliază și `INITIAL_SESSION` când identitatea lipsește sau diferă; pentru aceeași UUID, păstrează metadatele proaspăt citite prin Auth în locul copiei din cache.

Modulele folosesc API-urile `window.*` pentru HTML și integrări. Sporturile din administrare sunt afișate ca text simplu, inclusiv în setările terenurilor și în editorul bazelor. Evenimentele `spotivity:profile-user`, `spotivity:language`, `spotivity:admin-role` și `spotivity:admin-clear` continuă să sincronizeze modulele. Rolul și alocările reale provin din `get_admin_access()`; restricțiile sunt impuse în continuare de Supabase.

La modificări, păstrează starea mutabilă prin referință, verificările după operațiile asincrone și curățarea imediată a datelor la schimbarea contului. Actualizează împreună scripturile și referințele lor din `index.html`, apoi rulează suitele browser relevante din `supabase/tests/`. Comenzile de pornire și verificare sunt în [README-ul site-ului](../README.md).
