# Member journeys and provider administration

## Visitor flow

The home and first-step category/destination selection remain public. Opening a provider/product detail, calling a provider, viewing a chosen route, or opening a basket asks for registration. The prompt uses the existing Supabase phone OTP component, with legacy confirmed-email sign-in retained. It resumes the selected UI action rather than resetting the journey. Direct detail URLs return a generic membership shell until the session is verified on the server.

`/api/member` verifies the token using `auth.getUser()` and issues a same-origin HttpOnly, Secure, SameSite=Lax cookie. No admin decision is based on user-editable metadata. Return URLs are local, allowlisted and token-stripped. Public static map/directory files remain public discovery/reference data; this feature is an application access/conversion boundary, not encryption or a paywall over the raw datasets.

## Provider page and basket

Every member provider page loads its own products from `/api/provider-catalog`: reviewed menu records, advertised service offers, admin catalog overrides and approved, correctly associated seller listings. Unknown products/prices are not invented. Managed items with variants link to the existing variant picker. Real checkout remains under the existing seller consent, opening-hours and stock rules.

The provider basket stores item IDs and quantities, scoped to the current account and provider. Its quote endpoint recomputes current prices, active offers and explicitly declared tax. Unknown price/tax/delivery costs are disclosed. A quote does not create an order, reserve stock, charge money, or mark the service as accepting orders. Existing seller checkout remains available through the linked-store action.

## Admin path

Market → Administration → **مقدمو الخدمات ومنتجاتهم**.

Admins can search/filter providers, edit category/name/address/contact/map/image URL/service area, create a provider, archive/restore providers, and add/edit/archive/restore catalog products including category/section/image URL/price/offer expiry/quantity/availability/tax/order. The panel preserves the existing one-question form component. Registered sellers and native managed listings also retain their existing management tab.

All new writes require a verified admin and use the existing audited `jowwa_admin_save` RPC. No schema migration or new service-role secret is required. Product settings use deterministic `provider-product-<digest>` keys in `site_content`; provider edits use the existing places records. Stale version checks reject ordinary out-of-date saves; they are not a replacement for atomic database compare-and-swap. Provider ownership, consent and acceptance fields cannot be changed through the new API.

## Tests and limits

- 208 tests passed in the isolated development run (existing regressions plus auth/API/catalog tests).
- 16 Playwright checks passed across mobile 390×844 and desktop 1280×850. They covered free initial selection, delayed sign-in, a simulated OTP sign-in that resumes the same route, guarded direct provider URL, basket quantities/totals, nonadmin rejection, and admin product create/edit/archive/restore plus provider edits.
- Browser tests used an isolated in-memory provider database and stubbed Supabase OTP responses; no real SMS, real account creation, phone call, order, inventory mutation or production data edit was performed.
- Before rollout, verify the actual deployed member endpoints, configured phone-auth flag, static assets and guest flow. A real OTP delivery and an authenticated production admin save are not certified by the fixture tests.

## Files and routing

The existing service-claims gateway also handles `member`, `provider-catalog` and `provider-admin` routes so the project does not gain extra serverless functions. Existing detail handlers are kept as legacy renderers behind new authentication wrappers. `/menu/:id` resolves current provider overrides; old `/market?menu=...` links canonicalize to that guarded detail route. Source metadata and original URLs remain intact.
