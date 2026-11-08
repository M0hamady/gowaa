# Jowwa Django + Channels preview foundation

This service is isolated to `feat/django-channels-backend-preview`. It is not wired to the existing Node/Supabase production app.

## Preview topology

- Render Free: Django ASGI served by Daphne.
- Upstash: Redis channel layer (set `REDIS_URL`).
- MongoDB Atlas: preview-only courier location samples with 30-day TTL.
- Supabase: use a NEW preview project/database only for relational staging data.
- Vercel: frontend Preview deployment only; no production aliases.

## Current scope

- Django ASGI/Daphne boot configuration.
- Health endpoint at `GET /api/health/`.
- Authenticated Django-session WebSocket transport smoke test at `/ws/health/` (ping/pong).
- MongoDB helper for storing validated courier GPS points after caller-side authorization.
- Render Blueprint for a manually created preview service.
- A basic Django health endpoint test.

## Explicitly not implemented

This is infrastructure scaffolding, not a complete replacement backend. It does not yet implement Supabase JWT authentication/membership authorization, merchant kitchen/order APIs, courier assignment, payment/inventory side effects, production analytics, or frontend integration. The existing application remains the source of truth. Do not point this service at production credentials or production data.

Before enabling business WebSockets, implement and test Supabase JWT verification and server-side merchant/courier membership checks. The current health socket uses Django session auth only and is a transport smoke test, not the app's real-time order channel. Never authorize access based only on a client-supplied merchant/order/courier ID.

## Local checks

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python manage.py check
python manage.py test
daphne -b 127.0.0.1 -p 8000 config.asgi:application
```

## Render setup

1. Create a Render Web Service from this branch.
2. Select Docker and use `backend/Dockerfile` with `backend` as the Docker context.
3. Create separate preview resources for PostgreSQL, Redis, and MongoDB. Add their connection strings as secrets.
4. Configure CORS/CSRF origins to the exact Vercel Preview domain.
5. Do not run migrations against the live Supabase project. No migrations are required by this scaffold.
6. Deploy and verify `/api/health/`; then test WebSocket ping/pong with an authenticated preview session.

Free services can sleep, restart, or enforce quotas. This environment is for QA only, never real customer orders or live courier tracking.
