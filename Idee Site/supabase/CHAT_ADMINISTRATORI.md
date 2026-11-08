# Chat administrativ numai pentru administratorii terenurilor

Actualizat pe 8 noiembrie 2026. Migrarea **032_court_staff_chat.sql** este aplicată live după verificarea cu rollback. Mesajele existente, rezervările, conturile, alocările, campaniile și cozile de notificări au rămas neschimbate.

## Comportament

- Superadminul nu are butonul de chat administrativ, badge de mesaje, abonare realtime sau scurtături Chat în tabelul rezervărilor și în contextul administrativ din email.
- Administratorii obișnuiți citesc și răspund numai pentru terenurile alocate. Schimbarea rolului în superadmin curăță conversația, drafturile și badge-ul și închide abonarea realtime; răspunsurile întârziate nu pot repopula interfața.
- Mesajele clienților generează notificări numai pentru administratorii obișnuiți alocați. Dacă terenul nu are un astfel de administrator, mesajul rămâne salvat, fără email către superadmin. Nu se trimit notificări retroactive după alocare.
- Răspunsul administratorului ajunge în continuare la clientul real al conversației. Folosirea personală a contului ca client pentru o rezervare proprie rămâne limitată la conversația proprie și nu deschide inboxul administrativ.
- Notificările de rezervare și anulare își păstrează regulile existente, inclusiv destinatarul de rezervă pentru terenurile nealocate. Modificarea se aplică chatului, nu tuturor emailurilor superadminului.

## Aplicare în server

Helperul nou `manages_court_chat` separă permisiunea de chat de administrarea generală. Patru politici RLS restrictive completează politicile existente, inclusiv în prezența unor politici permisive generale. Triggerele de chat și contextul autorizat din email folosesc aceeași regulă.

`chat_notification_owners` exclude superadminii și mailboxurile lor din destinatarii administrativi de chat. `notification_payload` reverifică și joburile vechi înainte de revendicare: o notificare de rezervă către superadmin nu mai produce un payload expediabil. Migrarea nu resetează lease-uri și nu retrimite joburi; nu schimbă scenariile sau conexiunile Gmail din Make.

La verificarea live: **zero destinatari superadmin de chat** și patru relații teren–destinatar administrativ eligibil. Accesul autentificat al superadminului la conversațiile altor clienți a fost refuzat prin RLS. Scenariul de email Chat din Make a fost găsit oprit; starea sa de activare și scenariile manuale au fost păstrate. Chatul din aplicație funcționează independent de emailurile Make.

## Migrarea031

031 rămâne pregătită pentru trecerea viitoare pe `spotivity.ro`, fără aplicare în această modificare. Ea este independentă de 032: poate fi aplicată înainte sau după aceasta. Verificarea exactă a rendererului din 031 continuă să protejeze definițiile necunoscute; migrarea nu poate fi reaplicată.

## Verificări

- SQL real izolat cu ID-uri chat UUID și numerice: permisiuni, notificări, fallback, lease-uri, schimbarea rolului și păstrarea datelor.
- Chromium cu SDK-ul real și PostgreSQL izolat: absența chatului/realtime pentru superadmin, accesul și răspunsul administratorului alocat, scurtăturile și răspunsurile întârziate după promovare.
- Regresii pentru fluxurile complete, pagina administratorului, linkurile din email, notificări, artefactul public și migrarea031.
- Buildul public păstrează 70 de fișiere aprobate și exclude SQL, sursele server, testele și documentația.

Nu au fost trimise mesaje sau emailuri reale de test. Nu a fost pornit un deploy Netlify sau Edge. Modificarea frontendului se distribuie prin push-ul Git solicitat.
