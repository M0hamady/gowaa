# Jowwa mobile-first front-end journey map

Updated: 2026-11-11. Audited repository `M0hamady/gowaa`, not a speculative redesign. This is the implementation baseline; do not replace the existing assistant-led home.

## Existing navigation and page ownership

| Surface | URL / internal view | User goal | Existing action | Mobile main tab |
|---|---|---|---|---|
| Home assistant | `/`, `#home-screen` | Ask in natural Arabic and get an action | Existing assistant + intent shortcuts | الرئيسية |
| Kayan internal navigation | `/#trip`, `#trip-panel` | Find a building/service, calculate and follow a route | Existing map/route/GPS, not a new router | المشاوير |
| Bus and returns | `/?tab=bus` / `/buses` | Outbound/return bus line and sources | Existing transit state and schedules | المشاوير |
| Published places | `/places`, `/place/:id` | Find a verified directory entry, directions/contact | Existing directory/place cards | الخدمات |
| Services | `/market?view=services` | Find a published service provider and available request action | Existing service view and provider policies | الخدمات |
| Printing | `/market?view=printing` | Compare printing shops, provider portfolio and order | Existing printing marketplace | الخدمات |
| Product catalog | `/market` | Find products/menus, build cart | Existing browse/market and provider flows | السوق |
| Merchant area | `/market?view=mine` | Manage listings, catalog and ownership | Existing authenticated merchant view | نشاطي |
| Provider detail | `/place/:id` | Discover business, navigation or request | Existing public profile flow | Contextual, no extra nav |
| Orders / tracking | `/order/*`, `/track` | Track a specific order | Existing token-based tracking; NO public dock injection | Dedicated protected workflow |
| Merchant operations | `/work` | Operate cash register, order and queue | Existing role-specific operations UI | Dedicated protected workflow |

## Mobile UX contract

1. **Do not redesign the home.** Keep `home-screen`, greeting, `home-ai`, intentional shortcut details and map as currently implemented.
2. The shared five-tab dock is mounted progressively on public app pages already loading `ui-controls.js`; it reuses existing clicks/links. No new parallel route state.
3. Navigation, active-map turn-by-turn guidance, open dialogs and checkout overlays must never be occluded by the bottom dock. Preserve safe-area insets and 44px+ targets.
4. For routes or services, do not infer user GPS without permission or invent public transit schedules or provider availability.
5. Role-specific operations and tracking retain their dedicated UI to avoid unauthorized shortcuts or interrupting an active workflow.
6. Service discovery and messages must remain bound to actual provider IDs and explicit user confirmation. The Supabase frontend / Django JWT bridge is still an integration task; do not fake a logged-in session.
7. Direct links to provider pages, market views, buses and map destinations must keep working from messages/QR/share previews.
8. All primary flows must pass automated unit tests and mobile browser tests before any production merge.

## Remaining rollout gates (not claimed complete)

- Real-user browser E2E for home → map destination → route → return to Kayan, including mobile safe areas, GPS denial and history back.
- Home → service result → real provider profile → explicit customer request → provider inbox → customer follow-up. Authenticate correctly across Supabase and Django.
- Marketplace: service/printing/product listings → basket → pricing/delivery choice → confirmation → tracking, with merchant/driver permissions.
- Test role views: visitor, customer, service owner, store manager, cashier, driver, printer, admin; make sure account state doesn't persist after switching identities.
- Test accessible focus behavior, keyboard obscuring the dock, PWA display=standalone and sub-360px screen widths.
- Validate Vercel preview on actual iOS Safari and Android Chrome before promoting to production.
