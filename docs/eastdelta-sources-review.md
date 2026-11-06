# East Delta official search review

Checked **6 November 2026**, approximately 14:38 UTC. Reference: `public/data/eastdelta-reference.json`.

## Identity and scope

The [government company directory](https://www.bsic.gov.eg/SubCo.aspx?CoID=3) identifies East Delta Transport and Tourism and links its operator domain. The [operator station directory](https://eastdelta-travel.com/master/station) lists Turgoman at **مول وسط العاصمة**. Its Cairo recruitment station is at Gesr El Suez; this must not be confused with Kayan's Gate 1 recruitment gate.

The [official homepage](https://eastdelta-travel.com/) supplies a city/station/date search. Its city selector contained 35 entries. The dataset preserves those advertised choices, not 35 asserted direct routes from Turgoman. Seven Cairo departure stations and four arrival choices in Alexandria/Sharm were read from the website's public station lookup. Other cities require a fresh official station selection.

## Observed public contract

All successful checks below used ordinary Chromium with certificate verification enabled. Only public GET requests were sent; no ticket, seat, account, payment or reservation operation was invoked.

- Origins: `GET https://eastdelta-travel.com/statid5?city_id=1`; JSON key `stat_id5`, fields `station_id` and `station_name`.
- Destinations: `GET https://eastdelta-travel.com/statid6?city_id=2` or `city_id=74`; JSON key `stat_id6` with the same fields.
- Dated search: `GET https://eastdelta-travel.com/master/tripcity` with **all five** parameters: `from_city_id`, `from_station_id`, `to_city_id`, `to_station_id`, `trip_date` in `YYYY-MM-DD` format.
- Cairo is city **1**; Turgoman is departure station **30210**. Alexandria is city **2**, with **30319** (اسكندرية) and **30278** (محرم بيك). Sharm is city **74**, with **30221** (شرم الشيخ) and **30327** (حى النور).

The official [contact page](https://eastdelta-travel.com/master/contact-us) and site footer list 5900 and 09000217. The footer and homepage show 0222633254; a contact-card variant has an extra digit, so the dataset uses the repeatedly displayed number rather than the inconsistent card.

## Dated evidence — not a reusable timetable

[Turgoman → Sharm, 7 November 2026](https://eastdelta-travel.com/master/tripcity?from_city_id=1&from_station_id=30210&to_city_id=74&to_station_id=30221&trip_date=2026-11-07) returned HTTP 200 and six dated results:

| Displayed trip ID | Departure | Displayed fare |
| --- | --- | --- |
| 380687 | 08:30 | EGP 410 |
| 379219 | 13:30 | EGP 410 |
| 379228 | 16:30 | EGP 410 |
| 379221 | 19:30 | EGP 410 |
| 379553 | 22:00 | EGP 410 |
| 379433 | 23:45 | EGP 410 |

All displayed **الترجمان → شرم الشيخ**, **2026-11-07**, and **فرست كلاس**. This records the observed response only. It does not establish repeating service, current remaining seats, final fare or a completed booking. These clocks and fares are intentionally absent from the public reference dataset.

[Turgoman → Moharam Bek, the same date](https://eastdelta-travel.com/master/tripcity?from_city_id=1&from_station_id=30210&to_city_id=2&to_station_id=30278&trip_date=2026-11-07) returned HTTP 200 with no available trips displayed. That outcome is limited to the exact station/date query; it is not evidence that East Delta never serves Alexandria.

## Access limitation and application behavior

Standard Node HTTPS fetch failed with **unable to verify the first certificate**, including with Node's system CA option. Chromium could validate and read the same operator pages. No verification bypass was used. The homepage's full load stalled on external resources, so subsequent read-only inspections omitted images/scripts and inspected the returned public document and GET search result directly.

Until the operator's certificate chain works with the production server trust store, use **`official_link_only`**: construct a whitelisted, dated official search URL from verified station IDs and let the passenger review the operator's result. Do not deploy `rejectUnauthorized:false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, insecure HTTP fallbacks, or treat an HTTPS failure as an empty timetable. Ask the user to select an exact station when more than one is available.

Primary web references for the search review: government directory, official station page, official homepage and official contact page. Dated result evidence came from a real browser GET on the operator domain. The lookup paths were observed in the official page's own form/script rather than guessed.
