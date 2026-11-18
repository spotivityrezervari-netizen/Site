# Cereri pentru terenuri într-un sport nou (migrarea 044)

## Ce face
- Un administrator obișnuit poate adăuga **direct** terenuri doar în sporturile pe care baza lui le are deja.
- Pentru un sport pe care baza **nu îl are încă**, formularul „Adaugă un teren” din panoul administratorului devine automat o **cerere**, cu mesaj opțional. Cererea ajunge la superadmin.
- Superadminul vede cererile în panoul de admin, la cardul **„Cereri sporturi noi”** (cu număr de cereri în așteptare), și le **aprobă** sau le **respinge**, cu motiv opțional.
- La aprobare, terenul se creează în baza respectivă (oraș și locație luate din bază) și se alocă administratorului care l-a cerut.
- Administratorul vede starea cererilor sale (În așteptare / Aprobată / Respinsă, plus motivul respingerii) în același formular.

## Baza de date (`044_new_sport_court_requests.sql`)
- Tabel `public.cereri_teren_sport_nou`, cu RLS activ. Îl citesc doar solicitantul și superadminii. Scrierea se face numai prin funcțiile de mai jos.
- `public.request_new_sport_court(p_base_id, p_name, p_sport, p_price, p_hours, p_message)` – administratorul trimite cererea. Verificări:
  - baza îi este alocată;
  - sportul e nou pentru bază;
  - numele terenului e unic;
  - o singură cerere deschisă pe bază și sport;
  - maximum 10 cereri pe zi pentru același cont.
- `public.approve_new_sport_court_request(p_request_id, p_note)` – doar superadmin. Creează terenul și îl alocă solicitantului.
- `public.reject_new_sport_court_request(p_request_id, p_reason)` – doar superadmin.
- Trigger `spotivity_court_new_sport_guard` (BEFORE INSERT pe `public.terenuri`) blochează orice cale prin care un administrator obișnuit ar crea un teren într-un sport nou pentru bază. Superadminii nu sunt afectați.
- `create_managed_court` și celelalte funcții existente au rămas neschimbate.

## Frontend
- `js/owner-court-create.js` + `css/owner-court-create.css`: modul „cerere” în formularul administratorului.
- `js/admin-sport-requests.js` + `css/admin-sport-requests.css`: lista superadminului, cu butoanele Aprobă / Respinge.
- `index.html`: cardul `#btn-cereri-sport-admin` și fișierele noi.

## Neinclus (încă)
- Nu se trimite email la cerere sau la decizie. Se poate adăuga ulterior prin Make, pe modelul `016_notification_outbox`.
