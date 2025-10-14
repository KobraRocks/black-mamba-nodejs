Black Mamba E2E Simulation

Goal
- End-to-end scenario that exercises a “production-like” flow:
  - Static file served from `public/`
  - Passwordless sign-in via Magic Link
  - Session cookie persisted and enforced on a protected route
  - Passkey (WebAuthn) registration and authentication
  - Protected route accessible after passkey sign-in

Status
- This document proposes the scenario and an implementation plan. The E2E runner is provided as a scaffold but is intentionally not wired into `npm test` yet to avoid failing the build until endpoints exist.

Environment Assumptions
- Node 18+
- ESM only (no external deps)
- App starts via `node app.js`
- Dev vs Prod: Production is default. For simulation under HTTP, `BM_DEV=true` disables secure cookies.

High-Level Scenario
1) Start server (HTTP/1.1) with `BM_DEV=true`, `BM_DATABASE` pointing to a temp DB, and `BM_PORT` set.
2) GET `/` to fetch `public/index.html` (or any existing static asset).
3) POST `/auth/magic/request` with `{ email }` to initiate Magic Link login.
   - In dev/test, the API responds with `{ url, token }` for capture.
4) GET the Magic Link callback `/auth/magic/callback?token=...`.
   - Server validates and consumes token, sets session cookie.
   - Returns 200 and a small JSON (e.g., `{ ok: true }`).
5) GET `/me` (protected) with session cookie.
   - Returns 200 with the signed-in user data.
6) WebAuthn registration:
   - GET `/auth/webauthn/register/options` → returns PublicKeyCredentialCreationOptions (+ stores `challenge` server-side bound to session).
   - POST `/auth/webauthn/register/verify` with fake attestation response (generated inside the simulation) → server verifies and stores credential for user.
7) WebAuthn authentication:
   - GET `/auth/webauthn/login/options` → returns PublicKeyCredentialRequestOptions (+ stores `challenge` server-side, provides `allowCredentials`).
   - POST `/auth/webauthn/login/verify` with assertion response → server verifies and sets a fresh session.
8) GET `/me` (protected) using new session cookie → 200.

Coverage Matrix
- Static assets: OK (router serves `public/`).
- Magic link happy path: request → token → callback → session cookie.
- Session persistence: Cookie capture and reuse across requests.
- Protected route enforcement: 401 without session, 200 with session.
- WebAuthn register + login: challenge issuance + verification + credential storage.
- Data persistence: users and credentials stored via `ApplicationRecord`.

Constraints & Decisions
- Secure cookies require HTTPS. Since the built-in server is HTTP, we must run with `BM_DEV=true` during simulation to allow non-secure cookies. This preserves production defaults while enabling a reliable E2E loop under HTTP.
- Email sending: in production use SMTP lib; in dev/test the request endpoint should return the magic link (token+url) to avoid external side effects.
- WebAuthn responses: for E2E we will use deterministic, locally generated responses (no external dependencies). The verification helpers in `libs/webauthn` will be used.

