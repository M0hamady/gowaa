# Cart, booking and direct navigation review

Date: 2026-11-06

## Release baseline

This change was developed from production `main` at
`411d4cc99374a55bc5f76c9f083cd588908ab09a`, verified against the production
deployment of `jowwa-kayan.vercel.app`. That version introduced academy booking
requests and SMS alongside the recent directory, provider profile and stock
availability improvements. The operations test branch was not used as the base.

## Confirmed causes

1. Provider catalog Add saved to `jowwa-provider-basket:<user>:<provider>`, while
   the floating provider-page basket read `jowwa-basket` and navigated to
   `/market?basket=1`. The customer therefore opened a different cart.
2. The provider booking link went to `/market?book=<provider>`. Marketplace
   initialization fetched discovery inventories before opening the booking form.
3. Seller, item and catalog URLs initialized the marketplace before displaying
   their requested detail in a dialog. This caused a visible intermediate screen
   and unnecessary discovery queries.
4. `visitor-services.js` fetched the entire places directory even when the page's
   server-rendered cards were already enhanced.
5. Provider catalog reads fetched unrelated providers' product overrides before
   applying a global 2,000-row limit. Besides transferring unnecessary data, this
   could exclude the requested provider's latest override as the catalog grew.

The original provider page already imported `customer.js` indirectly through
`ui-controls.js`. Missing customer initialization is **not** a confirmed cause.

## Resulting behavior

### Carts

- The provider-page basket opens that provider's cart in place. Add updates its
  count immediately without replacing the product cards.
- Valid quantity edits persist immediately. Only quote requests are debounced
  (450 ms). Superseded requests are cancelled, and stale responses are rejected
  using sequence, account and cart-version checks.
- Closing a cart retains the latest quantities and cancels unnecessary quoting.
  Errors provide an in-place retry; checkout remains disabled until prices and
  availability have been checked.
- Concierge checkout uses one question at a time, retains answers when returning
  to the basket, and skips delivery address for pickup.
- Managed product quantity changes update locally instead of reloading items and
  store availability for every tap. The minimum quantity applies to the complete
  cart line, allowing one more unit to be added to an existing valid line.
- The managed-order and provider-reference cart models remain distinct because
  their server checkout, stock and confirmation contracts differ. Their entry
  points now open the correct cart consistently.

### Service booking

The journey is parent name, number of children, one age per child, optional
preferred times, optional note, then an editable review. Changing the number of
children preserves existing answers and updates the visible age steps.

The shared step component respects disabled options, preserves consent wording,
updates required/optional hints, validates before advancing and keeps only the
current question visible. Requests are sent only from final confirmation.

Duplicate submission is prevented, retries use the same request ID, and a replay
is explicitly described as the request saved on the earlier attempt. An edited
draft is never represented as a newly saved booking when the server replays an
existing request. Loading failures have retry states; closing during loading does
not allow a late response to reopen the dialog.

### Navigation and network

- `/place/<provider>?book=1` opens booking on the provider page. Sign-in preserves
  this destination and the booking intent. Verified-phone requirements remain.
- Old `market?book` and `market?menu` links redirect to their direct destinations.
- Item, seller and catalog details are visible inline from server render, and
  their client entry does not fetch general marketplace discovery inventories.
- Provider editing code is split from the normal customer entry and downloaded
  when an administrator needs it.
- Provider data requests are coalesced and cached for 60 seconds. Failed loads
  are not cached as empty successful results.
- Member requests retain a 12-second deadline even when the caller supplies its
  own cancellation signal. An interrupted response body stays an error.
- Provider quote/order reads filter to the requested provider before the database
  row limit. Prices, stock and archive decisions remain freshly validated on the
  server; no price cache was introduced.

## Verification

| Check | Result |
| --- | --- |
| Full Node suite, `npm test` | 441 passed, 0 failed |
| Production bundle build, `npm run build` | Passed |
| Booking browser checks, 390×844 and 1280×850 | 185 passed |
| Cart browser scenarios | 15 passed |
| Built-page navigation browser scenarios | 8 passed |

Browser tests use real UI modules and, for navigation, real built entries and
server-rendered pages. Account, API, order and SMS responses are isolated fixtures
on loopback, with external browser requests blocked. They exercise network
failure, delayed response bodies, late quotes, repeated taps, account switches,
sign-in return, disabled choices, consent, editing and idempotent retries.

The scoped server-read test uses the real Supabase query serializer against a
mock PostgREST endpoint with more than 2,000 unrelated overrides. It verifies that
only the requested provider and its override are transferred, and that subsequent
price and archive changes are read fresh. Existing database tests continue to use
the repository's isolated PGlite setup.

### Measured provider-page to booking journey

Both versions were built and run with the same deterministic browser fixtures.
JavaScript bytes count unique requested script files before transfer compression.
API reads are requests observed in the browser, not internal database queries.

| Metric | Original production source | Updated source |
| --- | ---: | ---: |
| API reads | 22 | 3 |
| General discovery requests | 10 | 0 |
| `market.js` downloads | 1 | 0 |
| JavaScript bytes, uncompressed | 975,167 | 346,202 |

This is 64.5% fewer raw JavaScript bytes and 19 fewer API reads in the measured
journey. It is not a claim about wall-clock latency on every live network.
Three rapid provider quantity taps produce one quote for the final quantity;
managed-cart quantity taps make no additional item/availability requests.

## Reproducing the browser checks

Provide an installed Playwright runtime and Chromium browser. The scripts do not
require changing the application's dependencies. `PLAYWRIGHT_MODULE` can point
the navigation script at the installed Playwright package;
`CODEX_PRIMARY_RUNTIME_NODE_MODULES` provides the shared runtime lookup for the
other scripts. Optional browser-path overrides are documented in each script.

```sh
node scripts/qa-booking-wizard.mjs
node scripts/qa-cart-provider.mjs
QA_BASELINE_ROOT=/path/to/clean-411d4cc-checkout node scripts/qa-direct-navigation.mjs
```

Navigation builds temporary copies and does not rewrite the working checkout.
Screenshots and reports are generated in ignored test-output locations.

## Release scope

No database migration, order-confirmation contract or SMS provider change is part
of this release. The existing guarded live build and server authorization checks
remain in force. Browser tests do not send real bookings, orders or SMS. Production
verification should check the deployed commit, public routes, redirects and
generated chunk availability without creating customer transactions.
