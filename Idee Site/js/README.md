# Organizarea JavaScript

Toată interfața publică și administrarea rămân în `index.html`. Nu există o pagină separată de admin, un bundler sau o etapă de build.

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

`base-admin.js` aplică automat interfața proprie administratorilor obișnuiți numai după verificarea serverului. **Vezi site-ul** setează o vizualizare publică temporară, păstrată numai în memorie; actualizările periodice ale accesului nu o închid. Revenirea prin **Înapoi la administrare** sau intrarea din profil verifică accesul, identitatea și generația cererii, apoi restabilește baza selectată și poziția din panou. Logout-ul, schimbarea contului sau retragerea accesului șterg această stare. Reîncărcarea deschide implicit administrarea pentru administratorul obișnuit.

Înainte de revenire, controller-ele `closeSpotivityHomeMenu()`, `closeSportsBases()`, `closeCourtSearch()` și `closeSpotivityPublicCourts()` închid dialogurile și invalidează cererile/formularele publice, fără a anula rezervări. Astfel, starea `inert` este restaurată corect și o citire întârziată nu poate redeschide un formular peste panou. La intrarea în site, `refreshSpotivityPublicCatalog()` recitește terenurile și orașele, păstrează orașul selectat dacă este încă valid și apelează `refreshSpotivityDiscovery()` pentru carduri, prețuri și fotografii actuale. Continuările verifică generația și identitatea Auth.

Restaurarea profilului verifică din nou sesiunea după citirea datelor; un logout în timpul încărcării nu poate restaura identitatea veche. Urmărirea Auth reconciliază și `INITIAL_SESSION` când identitatea lipsește sau diferă; pentru aceeași UUID, păstrează metadatele proaspăt citite prin Auth în locul copiei din cache.

Modulele folosesc API-urile `window.*` pentru HTML și integrări. Sporturile din administrare sunt afișate ca text simplu, inclusiv în setările terenurilor și în editorul bazelor. Evenimentele `spotivity:profile-user`, `spotivity:language`, `spotivity:admin-role` și `spotivity:admin-clear` continuă să sincronizeze modulele. Rolul și alocările reale provin din `get_admin_access()`; restricțiile sunt impuse în continuare de Supabase.

La modificări, păstrează starea mutabilă prin referință, verificările după operațiile asincrone și curățarea imediată a datelor la schimbarea contului. Actualizează împreună scripturile și referințele lor din `index.html`, apoi rulează suitele browser relevante din `supabase/tests/`. Comenzile de pornire și verificare sunt în [README-ul site-ului](../README.md).
