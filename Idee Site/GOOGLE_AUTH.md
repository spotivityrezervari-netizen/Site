# Activarea autentificării prin Google

Site-ul folosește același Supabase Auth pentru Google și email/parolă. Butonul **Continuă cu Google** apare în ambele taburi ale dialogului numai dacă proiectul Supabase raportează providerul Google activ. Nu se adaugă secrete în fișierele site-ului sau în GitHub.

## 1. Creează clientul Google, gratuit

În [Google Cloud Console](https://console.cloud.google.com/), creează sau selectează un proiect. Deschide **Google Auth Platform**; în interfețele mai vechi apare la **APIs & Services → OAuth consent screen / Credentials**.

Configurează numele aplicației, emailul de suport și datele de contact. Pentru clienți din afara organizației alege audiența **External**. Autentificarea cere numai identitatea de bază: `openid`, email și profil. Nu adăuga acces la Gmail, Drive sau alte date.

În **Clients → Create client**, alege **Web application** și introdu:

| Câmp | Valoare exactă |
| --- | --- |
| Authorized JavaScript origins | `https://spotivityrezervari-netizen.github.io` |
| Authorized JavaScript origins, domeniul propriu | `https://spotivity.ro` și `https://www.spotivity.ro`, ca intrări separate |
| Authorized redirect URIs | `https://ndubcdwohqzgxpuiowye.supabase.co/auth/v1/callback` |

Callbackul este adresa Supabase de mai sus. Păstrează valorile exacte, inclusiv `/auth/v1/callback`.

Google generează un **Client ID** și un **Client Secret**. În modul **Testing**, adaugă conturile de test în **Audience → Test users**. Pentru accesul public al clienților, publică aplicația OAuth în **Production**, completând cerințele afișate de Google pentru aplicație, domeniu și politica de confidențialitate. Nu declara că un domeniu comun, precum `github.io` sau `supabase.co`, îți aparține.

## 2. Activează Google în Supabase

Deschide [providerii proiectului Rendez-Vous](https://supabase.com/dashboard/project/ndubcdwohqzgxpuiowye/auth/providers), apoi **Google**. Activează providerul, introdu **Client ID** și **Client Secret**, apoi salvează. Secretul rămâne exclusiv în configurarea Supabase. Nu îl trimite în conversații și nu îl introduce în repository.

În **Authentication → URL Configuration**, păstrează:

```text
Site URL pentru domeniul principal:
https://spotivity.ro/

Redirect URLs (intrări explicite; păstrează și callbackurile legitime existente):
https://spotivity.ro/
https://www.spotivity.ro/
https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/
```

Adresa legacy GitHub era configurată la verificarea din 22 octombrie 2026. Înainte de activarea domeniului propriu, verifică și salvează intrările exacte de mai sus, fără wildcarduri globale. Configurația Auth live nu a putut fi citită în sesiunea din 27 octombrie din cauza HTTP 401 al bindingului administrativ; documentația nu confirmă aplicarea ei. Nu activa skip nonce check, email opțional sau asocierea manuală a identităților pentru această integrare.

## 3. Verifică din site

Reîncarcă [site-ul public](https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/), deschide contul și apasă **Continuă cu Google**. Autentificarea folosește redirecționare în aceeași filă și PKCE. După consimțământ, Supabase verifică identitatea și întoarce utilizatorul în site.

Verifică un client nou, anularea din ecranul Google, deconectarea și un cont existent cu aceeași adresă Google verificată. Pentru contul existent, confirmă păstrarea rezervărilor și, dacă este administrator, numai a permisiunilor deja acordate. Asocierea identităților este făcută de Supabase; site-ul nu unește conturi și nu acordă roluri după email sau metadatele Google.

Google nu furnizează numărul de telefon prin această autentificare. Un profil nou îl poate completa din **Profilul meu → Editează profilul**, cu confirmarea existentă. Migrarea [018](supabase/018_google_profile_names.sql) folosește numele Google doar pentru profilurile viitoare și păstrează datele deja salvate.

Linkurile noi de resetare a parolei folosesc tot PKCE: solicită și deschide linkul în același browser, deoarece verificatorul rămâne local. Dacă folosești alt browser sau dispozitiv, solicită un link nou acolo. Linkurile vechi cu token în fragmentul URL rămân compatibile.

## Verificări tehnice izolate

Cu serverul local pornit și dependențele de test disponibile:

```bash
node supabase/tests/google-profile-names.test.cjs
SPOTIVITY_TEST_INTEGER_IDS=1 node supabase/tests/google-profile-names.test.cjs
SITE_BASE_URL=http://127.0.0.1:8104/ node supabase/tests/google-auth-browser.test.cjs
SITE_BASE_URL=http://127.0.0.1:8104/ node supabase/tests/auth-recovery.test.cjs
```

Fixture-urile folosesc SDK-ul real și date izolate. Nu contactează Google, nu trimit emailuri și nu modifică utilizatorii din proiectul găzduit. Testul efectiv al consimțământului Google poate fi făcut numai după configurarea clientului OAuth real.
