Feasibility Assessment

Available building blocks
- Static files: implemented by `router.js` (already served).
- Sessions: implemented and attached in `app.js` using `libs/session` with SQLite store.
- Magic Links: `libs/magick-links` provides token creation/verification + memory replay store.
- WebAuthn: `libs/webauthn` provides registration/authentication option generation and response verification.
- ORM: `ApplicationRecord` supports auto migrations and CRUD with SQLite.

Missing pieces (to implement)
- HTTP endpoints for authentication flows:
  - Magic link request + callback
  - Protected route (`/me`) requiring an authenticated session
  - WebAuthn routes for register/login options and verification
- Data models:
  - `users` (id, email, created_at, updated_at)
  - `webauthn_credentials` (id, user_id FK, credential_id, public_key, sign_count, transports, created_at, updated_at)
- Credential storage + lookup code (binding WebAuthn to users).
- Dev/testing affordances:
  - Magic link request returns `{url, token}` in dev/test (instead of sending email).
  - Allow pass-through config for relying party (rpId/rpName), default from host.

Constraints / caveats
- Cookies: In production the cookie is `secure`; under HTTP it won’t be sent. E2E must run with `BM_DEV=true` (already supported) to set non-secure cookies.
- SMTP: Not required for E2E (dev-mode return of magic link suffices).
- WebAuthn crypto: Our E2E will use minimal deterministic inputs. The provided verification utilities accept structured data; we’ll emulate the client responses without external tools.

Conclusion
- Feasible with small additions: an `AuthController` and 2 models (`User`, `WebauthnCredential`) using the existing libs. No external dependencies are required, and the server already supports migrations and sessions.
