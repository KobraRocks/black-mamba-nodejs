Implementation Plan

Phase 1 — Auth basics (Magic Link)

- Add `app/controllers/auth.js` exporting an `ApplicationController` instance with `namespace = 'auth'` and `resources = 'magic'`.
- Endpoints:
  - POST `/auth/magic/request` — calls libs/magick-links createMagicLink({ sub: email, purpose: 'login' }, { baseUrl: `${origin}/auth/magic/callback`, keystore, store })
    - Dev: respond with `{ ok, url, token }`. Prod: send email via `libs/smtp` and respond `{ ok }`.
  - GET `/auth/magic/callback` — verify token (and consume via store), find-or-create user by email, set session `{ user_id }`.
- Add `/me` route (e.g., `app/controllers/me.js`) that returns 200 with user when `request.session` has user; otherwise 401.
- Data: ensure `User.migrate()` runs. Add `User.find_by({ email })` helper usage.

Phase 2 — WebAuthn

- Add `app/models/webauthn_credential.js` with fields: user_id, credential_id, public_key, sign_count, transports.
- Add `app/controllers/webauthn.js` with routes:
  - GET `/auth/webauthn/register/options`
  - POST `/auth/webauthn/register/verify`
  - GET `/auth/webauthn/login/options`
  - POST `/auth/webauthn/login/verify`
- Track `challenge` per session (store in session or transient DB). Bind to RP ID and user.
- Use `libs/webauthn` verification helpers. Persist credential on registration and load by credential_id on login, updating `sign_count`.

Phase 3 — E2E Simulation Runner

- Implement `app/simulation/run_e2e.mjs` that:
  - Spawns the app with `BM_DEV=true`, `BM_PORT` random free port, `BM_DATABASE` temp file, `BM_MIGRATE=1`.
  - Uses native `fetch` or `http` to:
    1) GET `/` (static file)
    2) POST magic link request, capture token
    3) GET magic link callback, capture `Set-Cookie`
    4) GET `/me` with cookie, expect 200
    5) WebAuthn: fetch register options; produce a minimal deterministic attestation; POST verify; expect 200
    6) WebAuthn: fetch login options; produce assertion; POST verify; expect 200; capture cookie
    7) GET `/me` again; expect 200
  - Kills the app process at the end.
  - Remove the simulation database, because each simulation must start fresh
- Keep the runner out of `npm test` until endpoints land; then add `npm run test:e2e`.

Phase 4 — Hardening and Docs

- Add README updates describing the auth flows and environment variables:
  - BM_DEV, BM_MIGRATE, BM_DATABASE, BM_PORT
  - MAIL config if email delivery is enabled in production
- Add minimal input validation and rate limiting (optional, deferred).

Environment Variables (new)

- BM_DEV=true — enable dev mode (non-secure cookies, return magic link in response)
- BM_MIGRATE=1 — run migrations at startup
- BM_DATABASE — database path for the simulation
- BM_PORT — port to bind
- BM_RP_ID — override relying party id (defaults to `localhost`)
- BM_RP_NAME — override relying party name (defaults to `Black Mamba`)

Acceptance Criteria

- E2E runner completes all steps with 2xx responses at each phase and verifies cookies/session behavior.
- Database contains user and credential rows after flows.

Out of Scope (for now)

- Real email delivery (only logged or returned in dev)
- HTTPS termination inside the app (would require TLS certs)
