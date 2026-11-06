# Turgoman intercity coach sources and lookup review

Reviewed on 6 November 2026. Times in customer responses are explicitly in `Africa/Cairo`.

## Verified operator and station identity

The Egyptian Travel Agents Association lists the Arab Union for Land Transport and Tourism, Superjet, under licence855 and links to `https://superjet.com.eg/`. Opening that official domain redirects to the Superjet booking frontend at `https://superjet.transport-ticket.com/` with retailer130331 and carrierSUJT. This establishes the operator identity chain; a similarly named site is not automatically trusted.

The booking frontend's public assets identify the same carrier/retailer and use Distribusion's public location and connection endpoints. Both were read successfully without authentication, customer details, cookies, reservations or purchases. The station response identifies these actual codes:

| Place | Operator station code | Published English name |
| --- | --- | --- |
| Turgoman, Cairo | `EGCAICIN` | Cairo Torgoman Bus Station |
| Alexandria, Moharam Bek | `EGALEALE` | Alexandria Moharam Bek |
| Port Said | `EGPSDBPS` | Port Said Bus Station |

The names and codes are used together. Other Cairo stations are never silently replaced by Turgoman. A generic Superjet request asks the rider to confirm the terminal before a lookup.

Primary sources:

- [ETAA operator record](https://www.etaa-egypt.org/SitePages/CompanyDetails.aspx?licc=855).
- [Official operator domain](https://superjet.com.eg/).
- [Official booking frontend](https://superjet.transport-ticket.com/?retailerPartnerNumber=130331&marketingCarrierCode=SUJT&locale=ar).
- [Operator-filtered destinations from Turgoman](https://global-api.distribusion.com/suggestion-service/v3/locations?q=&rpn=130331&locale=en&carriers%5B%5D=SUJT&departureLocation=EGCAICIN&departureLocationType=station&limitTopLevel=100).

## What the live probes established

The public location lookup filtered by `carriers[]=SUJT`, departure station`EGCAICIN`, and station type returned Alexandria and Port Said on the review date. This is a list for this operator's currently exposed booking search. It does not establish all destinations offered by every operator at the terminal.

Read-only connection probes for **7 November 2026** returned:

| Exact requested station pair | Returned direct Superjet connections |
| --- | ---: |
| Turgoman→Alexandria Moharam Bek | 8 |
| Turgoman→Port Said | 10 |
| Alexandria Moharam Bek→Turgoman | 0 at the time checked |

The Port Said results included scheduled arrivals on8November for departures late on7November. The normalizer retains the arrival date and day offset. A zero result is reported as the search returning no matching upcoming direct service at the time of the check. It is not generalized into absence of transport or a universal return timetable.

These probes are evidence of working dated queries, not reusable schedules. Their departure clocks are not stored in the public catalog.

The validated request is a GET to:

```text
https://book.api.distribusion.com/api/connections
  ?retailer_partner_number=130331
  &marketing_carrier=SUJT
  &departure_station=EGCAICIN
  &arrival_station=EGALEALE
  &departure_date=2026-11-07
  &departure_time=00:00
  &currency=EGP
  &locale=en
  &pax=1
```

The request sends no origin GPS, phone number, account ID or previous chat to the operator. No booking, payment, reservation or seat-selection endpoint is called.

### Server-client limitation observed during final verification

The Python standard-library read-only probes above returned HTTP200 and the dated results shown. A later **Node.js fetch using the same exact public connection URL returned HTTP403 with an HTML response**. The same Node runtime successfully read the operator's settings endpoint. No HTTP(S)/ALL proxy was configured in that Sandbox, and the response was served via Google. This narrows the issue to the connection endpoint/provider treatment of that client; it does not prove the deployed production runtime will be accepted.

Investigation stopped after reading the status and headers. No TLS checks were disabled, no browser identity headers were impersonated, and no alternate route was used to work around the refusal. The code's response to this refusal is `coach_unavailable`, retaining the exact official dated search link for the rider's browser. A production read-only probe is required before describing the integrated lookup as working live. The dated research results establish source availability during that review, not a promise that Jowwa can always fetch the source.

## Other operators and source limitations

[The public-sector business information centre](https://www.bsic.gov.eg/SubCo.aspx?CoID=3) links East Delta's identity to `eastdelta-travel.com`. [East Delta's station page](https://eastdelta-travel.com/master/station) lists Turgoman in the downtown mall and separately lists El-Qolali in the Ramses service complex. These must not be conflated with each other or with the railway station. The [official contact page](https://eastdelta-travel.com/master/contact-us) publishes booking/inquiry channels.

East Delta is a separately labelled provider. Its search results are not replaced with Superjet results. The parallel review is documented in `docs/eastdelta-sources-review.md` and its validated reference data in `public/data/eastdelta-reference.json` when available.

During this review, a request to the legacy West & Middle Delta domain printed in older directories redirected to unrelated gambling content. That legacy URL is deliberately absent from customer booking links. Current schedules for that operator are not inferred from third-party timetable articles. The source review records the observation without treating the unrelated destination as transport information.

## Runtime boundaries

`src/server-assistant-coaches.mjs` performs a fresh dated lookup after the user chooses a destination and date. It permits only the known Superjet carrier, retailer and exact station codes. Both requested station identities, carrier, date, local timezone, single direct segment, segment times and arrival order are checked against the response. An invalid or mismatched response becomes an unavailable state with the official search link.

Requests have an eight-second timeout, a four-megabyte body ceiling, a six-request concurrency bound, and a short60-second cache. Identical simultaneous requests share one fetch. Failures are not cached as empty timetables. Every answer removes already departed rows using its fresh Cairo clock, including when the underlying response is cached.

The UI data distinguishes planned departure, scheduled arrival, arrival date and the time the operator was queried. It advertises neither live vehicle tracking nor guaranteed seats. Prices and seat counts are deliberately not inferred from partial fare objects. The official site completes price confirmation and any booking initiated by the user.

Access from Kayan to Turgoman is a separate map/feeder problem. A metro station's geographic proximity does not establish a safe walking path, station exit, travel duration or guaranteed connection. Coach search results therefore never promise that a local feeder will meet a particular coach.
