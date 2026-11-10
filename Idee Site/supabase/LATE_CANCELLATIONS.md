# Numărul anulărilor târzii

Migrarea [033_late_cancellation_counts.sql](033_late_cancellation_counts.sql) a fost aplicată și verificată în Supabase la 10 noiembrie 2026, după 027 și 032. Workerul `booking-notifications`, versiunea 8, este activ; toate cele patru fișiere sursă din pachetul publicat corespund exact codului testat. Migrarea 031, pentru domeniul anunțurilor, este independentă și rămâne neaplicată. Nu s-au creat rezervări și nu s-au trimis emailuri de test în proiectul live.

O anulare inițiată de client se înregistrează când mai sunt strict mai puțin de 60 de minute până la o oră rezervată sau când ora a început și încă nu s-a încheiat. Exact 60 de minute înainte nu se înregistrează. Mai multe ore anulate din aceeași rezervare produc cel mult un eveniment. Orele finalizate rămân protejate de regulile existente. Anulările personalului nu se atribuie clientului.

Identitatea unui client cu cont este UUID-ul Auth. Pentru un oaspete, identitatea este adresa de email fără spațiile de la margini, cu litere mici. Un oaspete și un cont care folosesc aceeași adresă au istorice separate. Contorul privește anulările târzii înregistrate; nu detectează și nu numără prezența la teren sau neprezentările. Nu închide și nu blochează automat conturi.

Textul de avertizare aprobat pentru confirmare/anulare este:

> La mai mult de 3 neprezentări, riști închiderea contului.

## Istoricul administratorilor

`list_late_cancellations(p_days)` adaugă `customers[].total_count`, numărul tuturor evenimentelor disponibile pentru identitatea respectivă în terenurile pe care administratorul le poate vedea în prezent. Superadminul vede totalul global, inclusiv istoricul terenurilor șterse; un administrator obișnuit vede numai ID-urile terenurilor alocate în prezent. Filtrarea permisiunilor se face înaintea numărării, inclusiv pentru evenimentele mai vechi decât perioada selectată.

Câmpurile existente `count`, `frequent` și `events` păstrează perioada aleasă, implicit 30 de zile. `frequent` rămâne adevărat de la trei evenimente în acea perioadă. Lista include clienții cu cel puțin un eveniment în perioada aleasă. Numărul total din interfața administratorului poate fi mai mic decât cel din emailul clientului, deoarece emailul descrie istoricul global al acelui client, iar administratorul obișnuit are acces limitat la propriile terenuri.

## Emailul automat

Primul eveniment târziu înregistrat după 033 pentru o rezervare păstrează în tabelul privat `late_cancellation_events` un `total_count` calculat din întregul istoric deja înregistrat, inclusiv evenimentele vechi. Valoarea rămâne cea de la momentul anulării; anulările viitoare și reîncercările livrării nu o schimbă. Blocarea tranzacțională a identității serializează calculul pentru anulări simultane în tranzacțiile obișnuite `READ COMMITTED`.

Nu se creează un nou job sau tip de email. Generatorul SQL existent al payloadului este păstrat sub numele privat `notification_payload_v32`; wrapperul adaugă numai la evenimentul exact `booking_cancelled_client`:

```json
{
  "late_cancellation": {
    "total_count": 4,
    "threshold": 3,
    "warning": "La mai mult de 3 neprezentări, riști închiderea contului."
  }
}
```

Workerul Edge revizuit include numărul și avertizarea în HTML/textul acelui email, apoi folosește fluxul Make existent. Make continuă să primească destinatarul și conținutul normalizat de server, cu același `notification_id` pentru deduplicare. Acceptarea webhookului de Make nu confirmă livrarea în inbox. Un email către proprietar, o anulare a personalului, o anulare timpurie sau un eveniment ulterior al aceleiași rezervări nu primește această secțiune.

Migrarea nu completează retroactiv coloanele noi și nu pune emailuri istorice în coadă. Rândurile vechi au `total_count` și `notification_event_key` nule; joburile lor existente nu primesc secțiunea de anulare târzie. Nu se inventează anulări din rezervări vechi. Tabelele private rămân fără acces direct pentru `anon`, `authenticated` și `service_role`.

## Aplicare și verificări

Aplică numai 033 după verificarea precondițiilor și publică separat workerul Edge compatibil. Site-ul și Netlify nu sunt publicate de migrarea SQL. Guardurile verifică proprietarul, `SECURITY DEFINER`, `search_path`, tipul rezultatului, volatilitatea și corpurile funcțiilor existente, plus trigger-ele de anulare. Hashurile sunt calculate din `prosrc` normalizat; hashul unei definiții complete `pg_get_functiondef` are o altă valoare. Definițiile găzduite revizuite și fixture-ul au aceleași corpuri normalizate. O modificare necunoscută oprește aplicarea pentru revizuire. Reaplicarea acceptă numai definițiile 033 cunoscute.

Testul izolat verifică aplicarea/reaplicarea, păstrarea datelor existente, limitele temporale, conturile și oaspeții, anulările parțiale, rollbackul, retrimiterile, drepturile administratorilor și payloadurile emailurilor:

```bash
NODE_PATH=/workspace/shared/spotivity-rls-validation/node_modules node --test --test-isolation=none --test-reporter=spec supabase/tests/late-cancellation-counts.test.cjs
```

Acest fixture folosește PGlite și o singură conexiune; testul nu demonstrează izolarea între sesiuni PostgreSQL reale și nu apelează Make sau adrese de email. O verificare separată în PostgreSQL 17.11, cu triggerul 033 extras în tabele temporare de test și două sesiuni `READ COMMITTED`, a forțat blocarea concurentă atât pentru același UUID, cât și pentru același email normalizat de oaspete. A confirmat așteptarea pe lockul advisory, contoarele 1 și 2 după commit, separarea cont/oaspete și păstrarea snapshoturilor la retry. Această probă verifică triggerul și concurența, fără a substitui testele complete de migrare și RLS.

## Configurația de livrare verificată

Scenariul Make `7938404` rămâne activ. Ruta existentă acceptă `booking_cancelled_client`, iar modulul Gmail folosește din webhook `to.email`, `subject` și `html`. Subiectul și corpul emailului de anulare târzie sunt pregătite de server; nu este necesar un webhook separat sau un al doilea email pentru aceeași anulare. Cheia de deduplicare rămâne `notification_id`, cu procesarea secvențială și confidențialitatea existente.

Setarea de server `BOOKING_SITE_URL` indică momentan `https://spotivityrezervari-netizen.github.io/Site/Idee%20Site/`, astfel încât linkurile funcționează pe site-ul folosit acum. Valoarea implicită din Git rămâne domeniul final `https://spotivity.ro/`. La lansarea pe domeniul final, actualizează și această setare; workerul validează destinația înainte de generarea capabilității de anulare. Nici cheile, nici webhookurile nu intră în fișierele publice.

Activarea a păstrat starea inițială `ready=true` a notificărilor și nu a invocat workerul. Verificarea live de după activare a găsit zero joburi recente de email, zero lease-uri active și zero evenimente de audit; datele de test au rămas în bazele temporare. Nu s-a făcut deploy pe Netlify.
