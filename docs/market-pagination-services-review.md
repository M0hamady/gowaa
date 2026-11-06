# Market pagination, readiness and services

Release prepared on 2026-11-06 from published main `bdb31457aa4548832f79b1dece11ead026b0a18d`.

## Customer behavior

The market now renders a fixed page of 24 product/reference-catalog results. Services, the directory, shops/restaurants, and leisure render 12 entries per page. Each pager has first/previous/numbered/next/last navigation, a result range, total, current-page announcement, and compact mobile controls. Changing a filter resets the page; invalid or excessive page numbers are clamped. Search, filters, sorting, tab and page state survive shared links and browser history.

The reusable pager reserves space above the floating basket. The mobile regression uses a visible filled basket and an ordinary pointer click, including a 320 px viewport. No forced click or hidden basket is used.

A dedicated **الخدمات** tab combines approved managed services with relevant public service providers. Food menus, unrelated landmarks, archived entries, malformed IDs and contacts awaiting consent do not enter this tab. Managed services have an independent database query so a large product catalog cannot displace older services from the mixed listing window. Service actions use honest request/enquiry wording; enabled academy booking links go directly to `/place/<id>?book=1`.

Provider cards are deduplicated against managed offers only through explicit seller and service-claim linkage. Distinct offers remain visible, and an academy's independent booking flow is retained. Reference menus remain references and never acquire stock or ordering permission through ranking.

## Readiness ordering

The default sort is labelled **الأكثر جاهزية**. It evaluates actual actionability before manual boosts or popularity:

| Level | Evidence |
| --- | --- |
| 5 | Available managed inventory with an open order gate, or an explicitly enabled booking provider |
| 4 | Available service with a valid external service action |
| 3 | Explicitly confirmed or provider-managed profile |
| 2 | Published actionable content or valid public contact |
| 1 | Descriptive directory entry |
| 0 | Unavailable or unpublished managed item |

Manual priority and existing popularity break ties within a level. A positive item priority takes precedence; a default zero may inherit an explicitly linked provider's priority. Names and phone numbers never establish that linkage. Price, name and newest sorts remain authoritative and have deterministic ID ties.

A closed, paused, loading, unavailable or unclaimed order gate cannot become order-ready because of a logo, historic sales, verification or a manual boost. Booking is an independent capability. Provider inventory counts are scoped to the seller **and** service claim; stock belonging to another business owned by the same seller is not borrowed.

## Loading and performance

- All market tabs share coalesced public places/catalog snapshots with a five-minute lifetime. Page and filter changes do not download the catalog again.
- Services query only approved service listings and approved active sellers when that tab opens. It does not first download food menus or the full discovery inventory.
- Strict live place overrides prevent a failed override read from resurrecting archived baseline entries. Failed cache entries are evicted and can be retried.
- Directory contact enhancement receives the already-loaded records synchronously. The shared observer mounts once even if both entry points import it, avoiding a second places/override download.
- Discovery computes facts and ranking keys once per filtering pass. Page changes reuse the ordered results and create only the current page's cards.
- Availability requests share pending seller/directory keys, skip fresh keys, keep batches at 100 keys or fewer, and preserve claim/directory alias consistency. A 15-second deadline prevents a stalled request from blocking the queue. Failure closes the affected gate instead of enabling an action.
- Availability cache lifetime is 45 seconds. Visible provider tabs refresh on a 30-second check; cached checks make no request. Booking-provider data has a 60-second lifetime. Hidden tabs do not poll their availability.
- Generation guards discard late responses after invalidation, navigation or newer loads. A delayed search cannot change another tab's URL.
- The former appended Food Location card now participates in the same ordering and page slice. Directory group placeholders are excluded before counting, so an automatically hidden placeholder cannot consume a visible page slot.

### Scope of pagination

This release implements bounded browser rendering over cached public snapshots. It does **not** introduce server-side pagination across the combined static directory and database catalog. The existing mixed managed-listing query remains capped at the latest 1,000 entries, with a visible notice. The independent service query has its own 1,000-service cap and notice. The entire current reference catalog is included. Checkout, stock and booking validation remain server-authoritative.

## Implementation map

| Area | Files |
| --- | --- |
| Shared pagination | `public/pagination-core.js`, `src/pagination-ui.js`, `public/market-pagination.css` |
| Product discovery and ranking | `src/market-discovery-ui.js`, `public/market-discovery.js`, `public/market-readiness.js` |
| Shared data and availability | `src/market-data.js`, `src/business-ordering.js` |
| Provider lists | `public/market-places-core.js`, `src/market-places-ui.js`, `public/market-places.css` |
| Services tab | `public/market-services-core.js`, `src/market-services-ui.js`, `public/market-services.css` |
| Market integration | `src/market.js`, `public/market.html`, `public/visitor-services.js` |

No SQL migration, production catalog edit, store activation or booking/order submission is part of this release.

## Verification

- Full Node suite: **493 passed, 0 failed**. Production bundle build passed.
- `qa-market-pagination.mjs`: 13 browser scenarios, including quantity selection/cart access from a later page, complete filter/history restoration, malformed page URLs, cache expiry, failed-source recovery and late-response suppression. It also verifies one gate read per managed item and explicit provider inheritance.
- `qa-market-services.mjs`: 83 assertions across 8 scenarios on mobile and desktop; includes 12-card pages, independent source retries, explicit data-cap notice, direct booking links and stale-generation handling.
- `qa-market-tabs.mjs`: 35 checks against the actual built market HTML/entry point. Fixtures include 72 products, 6 managed services and more than 90 providers. It verifies the tab/history integration, 24/12 bounds, Food Location appearing only on its own page, and no horizontal overflow at 390 px.
- The assembled check records one places download and one places-override read across browse/services/directory. Page/filter/history changes add no catalog reads. Advancing the clock 61 seconds and changing an open business to closed refreshes the gate without a full catalog download or a persistent loading state.
- Existing cart browser suite: 25 scenarios passed; existing booking wizard: 372 assertions across 16 scenarios passed; existing built direct-navigation/auth suite: 12 scenarios passed. Direct provider booking retains 3 API reads, no discovery request, and no market bundle.
- Browser fixtures run on loopback, block external requests and do not contact production or send real bookings, orders, messages or SMS. The known font import is served without its external URL in isolated fixtures; production styling is unchanged.

Public production pagination, services rendering and direct booking navigation are checked separately after the deployment becomes READY. Authentication-gated final booking/order submission is not claimed as a live production test.
