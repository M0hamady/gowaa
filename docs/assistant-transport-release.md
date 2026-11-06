# Egyptian assistant, saved journeys and transport map

Prepared on 6 November 2026 against production main `8c206fab8e9b6ba066ab0209a5b40a071e9c7cf9`.

## User story

A resident asks in Egyptian Arabic where to go, supplies one missing detail at a time, receives a source-backed answer, and can retain a supported local journey or explicitly submit a private transport/service request. The same public station records are accessible from the home screen, map, and assistant. Earlier cart, optional stock, service booking, readiness ranking and market pagination behavior remains the baseline.

The implementation supplies structured knowledge and dated operator lookups to the assistant. It does not fine-tune model weights or treat conversational guesses as new verified transport records.

## Public knowledge and coverage

| Dataset | Coverage | Interpretation |
| --- | --- | --- |
| `transport-hubs.json` | Owner-provided local stands, destination list, current/previous gate numbering and source links | Gate1 general06:00–14:00 is an operating window; the specific LRT feeder07:00–14:00 is separate. Neither is a fixed departure schedule. |
| `rail-network.json` | 95 unique stations, metro lines1–3 and LRT, six interchanges,15 directional first/last-service records | Official station order and terminal times, including branches and after-midnight offsets. No invented per-station arrival times or connection guarantee. |
| `transport-map.json` | 1,118 distinct geographic references:553 railway,84 metro,11 LRT-only and470 bus | Adly Mansour is shared, so the LRT filter includes12 stations. OSM geography does not establish current operation, a passenger entrance, or every stop in Egypt. |
| `enr-stations.json` | 39 stations supported by the observed public ENR booking search | Origin, destination and date are required before a public timetable request. The broader infrastructure map is not a list of bookable stations. |
| `intercity-coaches.json` | Exact Turgoman, Alexandria Moharam Bek and Port Said operator station identities | Superjet-only dated lookup, with the exact official search link on failure; not all terminal operators. |
| `eastdelta-reference.json` | 35 advertised city choices and11 verified station identifiers | Exact origin/destination station selection produces an official dated search link. No server-fetched East Delta timetable is claimed. |

The source reviews are in `rail-sources-review.md`, `enr-official-lookup.md`, `coach-sources-review.md` and `eastdelta-sources-review.md`. Station coordinates include source URLs and OpenStreetMap attribution. `scripts/import-transport-map.mjs` reproduces the normalized map from the reviewed Overpass export without interpolating missing station coordinates.

Turgoman is one canonical map record, `terminal-turgoman`. Nearby metro distances are straight-line geometry, not confirmed walking routes. The owner's Karatta stand link resolves to a named place, but its exact coordinate was not exposed reliably; it remains a working external reference without a guessed pin. No direct Kayan–Turgoman or Kayan–Alexandria coach is asserted without evidence.

## Conversation behavior

- The exact example `عماره ١٩٤ وعايز اروح موقف محطه رمسيس قطر` asks Yasmin versus Narges, retains the selected building and railway-station destination, and distinguishes Ramses-area alighting from the unverified last leg to the station entrance.
- Follow-ups can correct the origin, destination, date or time. Ambiguous bare hours ask morning/evening; a subsequent `09:00` retains the existing journey.
- Explicit national train questions are released by the metro and coach handlers. The country Qatar and a local journey to Ramses railway station are not misclassified as national timetable requests.
- Metro/LRT plans follow adjacent stations and published interchanges. A late LRT service terminating at Badr is never extended to a different terminus.
- Gate questions use the supplied current/previous numbering. OldGate1 is currentYasminGate2; oldGate10 is currentRecruitmentGate1; the current main gate is unnumbered.
- Map queries preserve station mode. Fuel stations, order status and generic local-service searches are not captured by the transport-location handler.

## Saved journeys and requests

`/api/assistant-journeys` and `/api/assistant-requests` are narrow routes in the existing service gateway, preserving the12-function deployment footprint.

Journey saving uses authenticated, verified accounts, server-derived public plans, bounded fields, per-account request identifiers and optimistic versions. Users choose the boarding/alighting references available in the source. A visit to an informal stand is labelled a user-chosen plan within its operating window. Boarded/missed/completed statuses are explicit passenger reports; elapsed time does not imply the passenger boarded.

Reminders are opt-in while the site is open, plus an actual calendar file with a reminder for the device calendar. There is no claim of background push delivery, GPS boarding detection or automatic SMS reminders.

Private transport and missing-service requests ask for the required details, show a review, and only acknowledge submission after a durable request exists. SQL records the request, history and notification-outbox entry atomically. Retries reuse the request identifier. Owner alerts use the existing trusted recipient and SMS budget, with a new narrow `assistant_request` kind. Older paused notification categories remain unchanged. The admin desk lists requests, reply/status controls, notification status and saved-journey reports.

The client clears private state on account changes, refuses stale account responses, and does not silently reopen authentication during a mutation. Guest login cancellation sends no persistence request.

## Network and response handling

- Station data loads on first opening the map and reuses one coalesced request. Results paginate20 at a time; viewport clusters cap map markers at140. Closing during a request does not reopen the panel later.
- Assistant public grounding shares a45-second coalesced cache. Deterministic transport and ordinary conversational flows do not consume the model quota.
- ENR uses an18-second deadline, bounded concurrency/body size and a five-minute cache; Superjet uses an eight-second deadline, six-request concurrency bound and60-second cache. Identical lookups share work, failures are not cached as empty timetables, and already departed rows are filtered against the current Cairo clock.
- Only fixed operator hosts and verified station identifiers are used. No private account data, phone number, raw GPS location or chat history is sent to transport operators.
- Final source probes found Superjet's connections endpoint returned403 to Node while a public Python read returned dated results. The app retains the exact official dated link and reports that the lookup could not be completed. Production acceptance must be observed before claiming the integrated source works there.
- East Delta's incomplete certificate chain is rejected by Node. TLS validation was not disabled; the user's normal browser opens the verified official query instead.

## Verification and release boundary

Before publication, the full Node suite passed690 tests with zero failures, and `scripts/build.mjs --production` completed successfully. Browser verification totals349 assertions across36 scenarios:143 conversation checks,74 actual-app/map checks,56 request/admin checks,38 saved-journey checks and38 targeted coach checks. The scripts use real application modules and isolated authentication/database/SMS fixtures. Actual home/map entry, guest account bridge and login cancellation were also exercised in the built application at320px and390px; the relevant screens were visually reviewed.

The new SQL files `036_assistant_journeys.sql` and `037_assistant_requests.sql` are additive. Tests exercise database permissions, idempotent retries, account isolation and unchanged existing functions. Production uses the existing guarded migration build: verify main, apply pending migrations, compare protected row counts, then publish only if the build succeeds.

Postdeployment checks must verify the exact main commit in `/operations-build.json`, open the production site, exercise read-only assistant/map and existing cart/service entry flows, and distinguish actual production observations from fixture-backed protected-write tests. No synthetic real booking, order, customer request or SMS is sent for QA.
