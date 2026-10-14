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

Scriptul reutilizează proxy-ul HTTPS al mediului și păstrează verificarea certificatelor TLS. Dacă Chromium raportează `ERR_CERT_AUTHORITY_INVALID` în sandbox, verifică accesul la baza sa de certificate NSS. În mediul pregătit, certificatul CA al platformei era deja de încredere, iar verificările au funcționat prin rularea scriptului cu mecanismul de escaladare permis al instrumentului de execuție. Nu dezactiva verificarea TLS.

Configurația publică Supabase este deja în codul site-ului. Nu adăuga credențiale private în scripturi sau documentație.

## Publicare și programul terenurilor

Site-ul folosit este [GitHub Pages](https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/), cu panoul [admin.html](https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/admin.html). Publicarea servește fișierele statice din `main`. Verifică ultimul deployment `github-pages` după actualizare.

Programul rezervabil se schimbă în setările fiecărui teren din admin: ore de început 09:00–22:00. Terenurile existente păstrează 12:00–22:00 până le modifici. Migrarea `supabase/003_court_hours.sql` este aplicată în proiectul existent; [instrucțiunile Supabase](supabase/README.md) explică pașii, rolurile și verificările. Nu rula din nou migrarea 001 după 003.


## Baze sportive și istoricul rezervărilor

Din pagina principală, butonul **Vezi bazele sportive** (sau **Baze sportive** pe telefon) deschide lista pentru orașul ales. Fiecare bază are descriere, terenuri și buton **Distribuie**. Rezervarea folosește formularul existent.

În `admin.html`, superadminul deschide **Baze sportive** pentru a crea o bază sau a-i modifica numele, orașul, descrierea și terenurile. Bifează terenurile existente, apoi apasă **Salvează baza**. Pentru un teren nou, folosește **Adaugă Teren → Baza sportivă**. Pentru mutarea unui teren, scoate-l întâi din baza veche și salvează. O bază fără terenuri active nu apare public.

În aceeași fereastră, **Cine poate edita descrierea** acordă explicit acces unui administrator. Acest acces permite doar descrierea; nu extinde accesul la rezervări, clienți sau alte terenuri. Superadminul are acces la toate bazele.

Rezervările finalizate rămân în istoric fără buton de anulare. O rezervare pe o oră se încheie la sfârșitul acelei ore: pentru 10:00, limita este 11:00, în fusul Europe/Bucharest. Rezervările viitoare și cele în desfășurare se pot anula conform permisiunilor existente. Regula este verificată și de baza de date, pentru client, admin și superadmin.

Migrările aferente sunt `supabase/006_sports_bases.sql` și `supabase/007_completed_booking_cancellation.sql`; nu rula fișierele din `supabase/tests/` în proiectul real.

## Căutare globală și terenuri pe pagina principală

Navigarea conține **Caută un teren**: caută după nume, sport sau oraș, fără să limiteze rezultatele la orașul ales. Diacriticele nu sunt obligatorii. Sunt afișate numai terenurile active accesibile public; încărcarea este paginată. Un card deschide formularul existent, care verifică din nou terenul prin Supabase.

Fiecare sport are un singur buton **Rezervă un teren** și o listă de carduri mici cu scroll lateral pentru orașul selectat. Tenisul de picior rămâne în secțiunea Fotbal. **Baze sportive** are o secțiune separată cu baze active care au terenuri active, filtrată după oraș.

În admin, **Setări baze sportive** apare pentru superadmin și pentru adminii obișnuiți cu alocare explicită în `baze_sportive_admini`. Adminul obișnuit poate edita numai descrierea bazelor alocate. Superadminul acordă acces din **Cine poate edita descrierea**; alocarea unui teren nu acordă automat acces la descrierea bazei. Nu se extind drepturile asupra rezervărilor sau altor terenuri.

Verificarea RLS în proiectul real a confirmat refuzul fără alocare, editarea numai a descrierii cu alocare și refuzul după retragerea dreptului. Proba s-a închis cu rollback, fără schimbări persistente în date sau permisiuni. Protecția migrării 007 pentru rezervările finalizate rămâne activă.
