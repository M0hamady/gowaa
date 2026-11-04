# Jowwa Operations Test Workspace — QA status

Date: 2026-11-04
Branch: `feat/operations-test-workspace`
Status: TEST WORKSPACE ONLY — not approved for production merge.

## Implemented test scope
- Role applications and admin review with synthetic identity fixture only.
- Provider/shop catalog, sections, products, inventory and staff permissions.
- Order lifecycle, preparation, delivery handoff, courier/driver bidding and assignment.
- Courier collections, store collections, debts, settlements and cashier shifts.
- Driver/courier tracking consent with browser geolocation + wake-lock behavior and honest stale/estimated labels.
- Provider-funded promotions.
- Dynamic platform fee rules scoped by global/category/shop/product with explicit bearer: customer/provider/platform.
- Dynamic order, delivery and online-payment accounting.
- Platform coupons, automatic discounts and cashback with budgets, use limits and per-customer limits.
- Admin "fees and offers" control UI.
- Customer coupon checkout display.
- Kashier TEST integration modeled on Exam Zone demo settings/interface.
- Online-payment intent, provider payout, platform fee accounting, failed-result handling and idempotency.
- Customer always-free account rule and test professional gift-month behavior.

## Payment safety
- Production environment and non-test branch are refused by the Kashier adapter.
- No fallback to Exam Zone/live credentials.
- Callbacks to live Jowwa or Exam Zone are refused.
- Demo API host is `https://test-api.kashier.io`.
- A real Kashier Demo session was successfully created in `mode=test` with no card details and no real charge.
- Dynamic fee snapshot is bound to amount/currency/order before a payment result is accepted.

## QA results
- Full repository Node test suite: 271/271 passed.
- Dynamic fees / benefits / payment focused suite: 38/38 passed.
- Payment browser journey: 5/5 passed.
- Mobile + desktop role/navigation/forms QA: 64 assertions passed.
- Isolated test build succeeded.
- Final build marker: liveBackend=false, realSms=false, realPayments=false, identityUploads=false.

## Deliberately NOT enabled
- Production/live payment.
- Real identity-card uploads.
- Real SMS/account signup in the test build.
- Production backend access from the isolated test build.
- Passenger-service production launch.

## Release rule
Do not merge to main or deploy to the production alias until product review, legal/privacy prerequisites, real test-environment credentials/callbacks, and a separate production rollout plan are approved.
