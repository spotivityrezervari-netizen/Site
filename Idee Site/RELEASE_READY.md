# Verificarea versiunii Git pentru lansare — 6 noiembrie 2026

Codul a trecut verificarea completă pentru publicarea frontendului pe Netlify. Verificarea a folosit PostgreSQL izolat, Chromium și artefactul real `dist`, inclusiv antetele HTTP Netlify. Nu a fost pornit un deploy și nu au fost create rezervări sau trimise emailuri reale.

## Rezultate

- 54/54 fișiere de teste SQL/Edge/browser au trecut pe versiunea curentă, inclusiv rezervări concurente, totaluri schimbate, reluări idempotente, anulări, roluri/RLS, OAuth, recuperarea parolei, chat, administrare, panoul de anunțuri și aspectul mobil.
- Testul separat al migrării031 a trecut: schimbă numai domeniul linkurilor din anunțuri și păstrează campaniile, destinatarii, configurația și politicile.
- 13/13 teste de build și cele11 verificări de contract Make/imagini au trecut.
- `netlify.toml` construiește prin `node scripts/build-public.mjs` și publică numai `dist`:70 de fișiere aprobate. SQL, sursele Edge, testele și documentația nu intră în artefact.
- Simularea artefactului public a validat încărcarea aplicației, CSP, antetele și refuzul servirii fișierelor interne.

## Corecția finală pregătită în Git

`supabase/031_production_announcement_links.sql` înlocuiește linkurile GitHub Pages din rendererul anunțurilor cu `https://spotivity.ro/`, aceeași destinație folosită de modelele tranzacționale din Git. Nu rescrie migrarea030 aplicată anterior, nu modifică destinatari și nu trimite emailuri. Refuză o definiție necunoscută a rendererului sau reaplicarea peste o versiune ulterioară.

**031 este pregătită, nu aplicată live.** Se aplică la trecerea pe domeniul final; site-ul actual de lucru pe GitHub Pages rămâne funcțional până atunci.

## Publicarea Netlify nu publică automat backendul

La verificarea live, `booking-workflow` este versiunea1, `booking-notifications` versiunea6, iar `club-applications` versiunea3. Acestea sunt versiuni mai vechi decât sursele actuale din Git. Preflightul pentru `https://spotivity.ro` primește403 atât la rezervări, cât și la înscrierea bazelor; GitHub Pages rămâne permis. Sursele actuale din Git conțin originile exacte apex/www și corecțiile testate.

La lansare trebuie publicate din aceeași versiune Git:

1. Migrarea031, după verificarea instalării030 și a definiției rendererului existent.
2. Cele trei funcții Supabase din `supabase/functions`, cu directoarele `_shared` corespunzătoare și secretele existente păstrate. Nu se rotesc cheile de anulare sau de serviciu în timpul publicării. Nu se reaplică migrările vechi.
3. Frontendul Netlify din `dist`, pe domeniul final configurat. Un hostname Netlify arbitrar nu este permis automat de CORS; configurarea domeniului final și callbackurile trebuie verificate exact.
4. Supabase Auth Site URL și redirecturile exacte pentru apex/www, împreună cu configurarea Google necesară domeniului final. Configurația actuală Auth are încă GitHub Pages ca Site URL.
5. Verificarea pe domeniul final a loginului, rezervării, anulării, chatului și panoului superadminului. Testele izolate nu sunt prezentate ca probă de livrare în inbox.

Aceste acțiuni de producție sunt separate de push și se fac la autorizarea lansării. Migrarea031 și publicările Edge nu au fost executate în această verificare.

## Configurații externe codului

Supabase Auth nu are SMTP extern, iar limita builtin verificată este două emailuri/oră. Recuperarea parolei există și este testată în cod, dar furnizorul pentru livrarea publică trebuie configurat și verificat separat. API-ul de backup raportează zero copii și PITR dezactivat; protecția datelor înaintea utilizatorilor reali se stabilește separat de buildul Netlify. Acestea nu sunt defecte ale frontendului și nu sunt remediate prin deploy static.

Nu este necesară adăugarea unor funcționalități noi sau câte unui webhook pentru fiecare email ca să publicăm această versiune.
