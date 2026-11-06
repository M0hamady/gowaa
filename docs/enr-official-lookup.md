# Official ENR date-specific train lookup

Verified on **6 November 2026 at 14:21 UTC** using the public Egyptian National Railways Arabic booking page. This work made no login, reservation, purchase or SMS request.

## Primary sources and reproducible route

- Public booking page: <https://enr.gov.eg/o-city/obs/enr/railway/ar/booktickets>
- Observed public station endpoint: <https://enr.gov.eg/api/v1/serviceTripPoints/stations?type=0&prefix=enr&project=enr>
- Date-specific public UI link: <https://enr.gov.eg/o-city/obs/enr/railway/ar/booktickets?from=CAIRO&to=ALEXANDRIA&trip=oneway&departure=2026-11-07>
- Observed read-only search: <https://enr.gov.eg/api/v1/tickets/search?from=606534187276566625&to=606535384603557938&transfers=false&with_reservations=true&without_reservations=false&skip_places_information=true&departureDate=2026-11-07&project=enr>

A clean Chromium session loaded the real Arabic booking form without console errors or failed network requests. Selecting Cairo, Alexandria and 7 November, then pressing the form's **Search** button, issued the GET above. The endpoint returned HTTP 200 and 35 results. A separate plain Node fetch, with no cookie, authorization header or browser session, also returned 200 and 35 results. That second request took approximately 9.5 seconds from the isolated verification environment; ordinary assistant questions therefore never call this endpoint.

The official route fields were `steps[0].train.name`, `fromDate`, `finishDate`, `duration` and the segment's `route` station IDs. For the specified date, train **119** was **05:00 → 09:45**, 285 minutes, in Cairo time. This observation does not establish a repeating daily timetable. The dated snapshot is retained only under `tests/fixtures/enr-cairo-alex-2026-11-07.json`; it is never used as a production timetable fallback.

## Station catalog

`public/data/enr-stations.json` contains the **39 stations returned by the official booking endpoint with `prefix=enr&project=enr`**. It retains only public station IDs, Arabic names, official English names, limited spelling aliases and source metadata. In particular, Cairo is `606534187276566625` and Alexandria is `606535384603557938`. The broader `usedInTrips=true` endpoint returned 668 records during exploration, but that broader catalog is not substituted for the booking-supported station list. This catalog is separate from the application's geographic rail station map.

## Runtime behavior

`answerIntercity({query,context,stations,now,fetcher})` starts only for an explicit train intent, or a continuation of an existing intercity conversation. A request to reach the Ramses railway station from a local building stays in the local travel flow. Metro/LRT questions stay in the rail network flow.

The assistant asks for one missing value at a time: origin station, destination station, travel date. It validates station IDs against the observed catalog and dates against the real calendar and a 90-day future window. Only a complete choice can make an external request. The service sends only canonical station IDs and date to a fixed official HTTPS endpoint, using GET. It sends no caller URL, contact details, account token, cookie or chat transcript.

The lookup has a 12-second deadline, a 4 MiB response limit, at most eight concurrent unique lookups, a maximum of 48 cached public routes/dates, a five-minute TTL and coalescing for identical requests. Failure is not cached. Timeout aborts the request and falls back to an honest message plus the dated official booking link. It does not convert unavailable data into a claim that no trains exist.

Returned rows contain train number, departure and arrival instants, Cairo display times, arrival calendar date/day offset and duration. `Intl.DateTimeFormat` with `Africa/Cairo` handles daylight saving time. Direct segment endpoints and departure date must match the requested journey. Seats, fares, reservation templates and purchase actions are not exposed. The first 12 future departures are shown with a total/hasMore indicator and the official link. These schedules do not create a saved bus journey or claim a reserved seat.

## Verification

`tests/assistant-intercity.test.mjs` covers the observed station catalog, actual dated fixture, Egyptian multi-turn questions, no lookup before all three choices exist, local-station and metro separation, explicit route reversal wording, exact date validation, canonical ID allowlisting, fixed-host read-only requests, daylight saving time, overnight arrivals, current-day elapsed departures, safe output fields, cache/inflight isolation and bounds, timeout, oversized/invalid response and honest failure handling. The combined conversational browser QA uses an injected official-response fixture so it never makes live ENR, account, booking or SMS writes.
