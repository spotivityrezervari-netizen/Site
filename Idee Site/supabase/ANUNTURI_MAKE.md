# Anunțuri și inventarul emailurilor Spotivity

Configurare verificată pe 5 noiembrie 2026. Niciun email real nu a fost trimis în timpul configurării.

## Cele două scenarii manuale

| Scenariu Make | ID | Destinatari |
| --- | --- | --- |
| Spotivity — Anunț manual numai pentru clienți | 8377771 | Conturi confirmate cu profil client, fără niciun rol de administrator |
| Spotivity — Anunț manual numai pentru administratori | 8377772 | Administratori obișnuiți și superadmini |

La verificare, listele au avut **7 clienți și 3 administratori**. Nu sunt liste copiate permanent în Make: Supabase stabilește grupurile și reverifică fiecare destinatar înainte de trimitere. Administratorii au și profiluri `clienti`, dar sunt excluși explicit din anunțurile pentru clienți. Oaspeții fără cont nu sunt adăugați automat. Fiecare mesaj are un singur destinatar, fără CC/BCC.

Accesul este protejat prin două chei independente, păstrate în conexiunile securizate Make; baza stochează numai hashurile. Cheia scenariului clienților nu poate selecta administratorii și invers. Nicio cheie de serviciu Supabase nu este pusă în scenariu sau în frontend.

## Cum trimiți tu un anunț

1. Deschide scenariul corespunzător în Make, în editor.
2. Deschide primul modul **Set variables** și completează `subiect` și `mesaj`. Mesajul este text simplu; formatarea HTML este generată și escapează caracterele speciale.
3. Păstrează `mod = PREVIZUALIZARE` și `numar_asteptat = 0`. Apasă **Run once** din editor. Răspunsul modulului **Previzualizează publicul actual — fără email** arată `count`, `stale`, `expired`, `manual_reconcile` și stadiile campaniei.
4. Verifică mesajul și numărul. Pentru aceeași campanie, pune numărul în `numar_asteptat` și schimbă `mod` în **TRIMITE**. Rulează din nou manual numai când vrei efectiv să trimiți.
5. După trimitere, revino la **PREVIZUALIZARE**. O reluare cu același `id_campanie` nu trebuie să retrimită persoanelor deja procesate.

Pentru fiecare **anunț nou** folosește un UUID nou în `id_campanie`; păstrează același UUID între previzualizare și trimiterea acelui anunț. Reutilizarea ID-ului pentru alt subiect, mesaj sau grup este refuzată. Dacă destinatarii se schimbă înainte de aprobare, previzualizarea este refuzată ca învechită; creează o campanie nouă și verific-o din nou. Aprobarea expiră după 24 de ore.

Scenariile au programare **on-demand** și sunt lăsate inactive pentru activarea automată. Planul curent are două locuri active, ocupate de rezervări și chat; API-ul Make refuză activarea unui al treilea scenariu. Nu au fost oprite automatizările existente și nu a fost schimbat abonamentul. Pentru anunțuri se folosește rularea manuală **Run once** din editor. Execuția automată prin API nu a putut fi validată din cauza acestei limite.

## Erori și prevenirea dublurilor

La eroare scenariul se oprește, fără retry automat Gmail. Registrul privat Supabase păstrează separat `pending`, `sending`, `sent` și `skipped`. `sending` indică un rezultat de reconciliat manual, nu permisiunea de a retrimite: Gmail ar fi putut accepta deja mesajul înainte de pierderea răspunsului. Nu relua direct de la Gmail și nu crea o nouă campanie doar pentru a forța o retrimitere incertă. Un rezultat de succes Gmail confirmă acceptarea trimiterii, nu ajungerea în inbox.

Make a păstrat `confidential=true` și `dlq=false` la citirea configurației salvate; stocarea execuțiilor incomplete nu este prezentată ca activată. Anunțurile folosesc registrul SQL și oprirea la eroare. Conexiunile Gmail folosite de scenariile existente au trecut operațiunea Make **Verify connection**; aceasta nu a trimis mesaje.

## Toate tipurile de email din Make

| Tip | Destinatar | Declanșare |
| --- | --- | --- |
| Confirmare rezervare | Persoana care a rezervat, inclusiv oaspete | Rezervare nouă |
| Rezervare nouă primită de bază | Personalul autorizat al terenului | Rezervare nouă |
| Confirmare anulare | Persoana care a rezervat | Anulare, inclusiv parțială |
| Anulare primită de bază | Personalul autorizat al terenului | Anulare |
| Mesaj nou de la client | Administratorul autorizat | Mesaj de chat al clientului |
| Răspuns nou de la administrator | Clientul conversației | Mesaj de chat al administratorului |
| Bun venit | Contul nou confirmat | Înregistrare nouă eligibilă |
| Anunț manual pentru clienți | Numai grupul clienți, fără admini | Trimiterea explicită din scenariul 8377771 |
| Anunț manual pentru administratori | Numai grupul admini, inclusiv superadmin | Trimiterea explicită din scenariul 8377772 |

Primele șapte rămân în cele două scenarii automate: **Spotivity — Rezervări, anulări și bun venit** (7938404) și **Spotivity — Chat pentru clienți și administratori** (7938798). Rutele și destinatarii lor existenți au fost păstrați. Anunțurile nu sunt introduse în webhookurile tranzacționale. Linkul din noile anunțuri deschide site-ul activ GitHub Pages.

## Emailurile de autentificare sunt separate

Recuperarea parolei și confirmarea schimbării emailului sunt gestionate de **Supabase Auth**, nu de Make/Gmail. La verificare nu există SMTP extern configurat, iar limita Auth este de două emailuri pe oră. Înregistrările sunt confirmate automat, deci nu este activ un email separat de confirmare a înscrierii. Nu confunda aceste mesaje cu emailul de bun venit din Make sau cu validitatea conexiunilor Gmail.

## Verificări și reproducere

- Migrarea **029_manual_announcement_campaigns.sql** a fost aplicată după acordul explicit al proprietarului. Numărul 028 exista deja în baza live și a fost păstrat.
- Tranzacția de instalare a verificat păstrarea celor 19 tabele existente, a celor 81 de funcții existente, a ACL-urilor și a politicilor RLS. Noile tabele au RLS și nu sunt expuse rolurilor API.
- Au trecut 15 verificări SQL izolate și patru verificări ale contractului blueprinturilor Make.
- Previzualizările REST live au confirmat listele 7/3 și refuzul accesului cu cheia grupului opus. Ele nu au aprobat campanii și nu au trimis emailuri.
- Blueprinturile au fost citite din nou din Make și verificate: grup fix în toate RPC-urile, cheie privată separată, un singur destinatar, fără CC/BCC, mod inițial PREVIZUALIZARE și oprire la eroare.
- Generatorul reproductibil și contractul tehnic sunt în `scripts/make-announcements.mjs`, respectiv `scripts/MAKE_ANNOUNCEMENTS.md`. Nu conțin secrete. Tokenurile noi nu se păstrează în Git.

Campaniile sunt pentru anunțuri operaționale către conturi. Sistemul nu presupune abonare promoțională și nu adaugă implicit oaspeți sau alte adrese la destinatari.
