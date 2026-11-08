# Jowwa preview backend plan

Branch: `feat/django-channels-backend-preview`

## Service split

- PostgreSQL/Supabase preview: canonical relational records (users, merchants, catalog, orders, payments, inventory).
- MongoDB Atlas preview: high-volume courier location samples and append-only live telemetry with an approved retention policy.
- Redis/Upstash: transient Channels fan-out and connection coordination; not the source of truth.
- Django + Daphne on Render: REST and ASGI/WebSocket service.
- Vercel Preview: browser client.

## User-facing resilience

- Hide infrastructure terms and reconnect noise from customers.
- Persist order creation before showing success; use idempotency keys.
- On reconnect, fetch canonical order state over REST before resuming live updates.
- Keep last-known courier point with its timestamp; never present stale GPS as live.
- Do not silently claim an order/payment succeeded without server confirmation.
- Surface only actionable order information (confirmation, preparation, courier assigned, delivery progress, delay, completion).
- Send operational diagnostics to logs/admin monitoring, not customer UI.

## Required implementation gates

1. Inventory current Supabase schema, RLS, RPCs, triggers, storage, auth, and existing Node routes.
2. Implement Supabase JWT verification and server-side merchant/courier membership authorization.
3. Port order state transitions with transaction/idempotency parity.
4. Implement outbox/event delivery so DB commit precedes broadcast and missed events can be replayed.
5. Implement GPS validation, rate limiting, retention/deletion, consent, and access scoping.
6. Implement analytics from canonical order/event data.
7. Integrate frontend only through preview env vars and test client/merchant/kitchen/courier roles.
8. Run automated tests and multi-device browser QA; verify sleeping-service recovery.
9. Create rollback and observability plan before any production proposal.

No production data, production secrets, production aliases, or main-branch changes are permitted in this preview phase.
