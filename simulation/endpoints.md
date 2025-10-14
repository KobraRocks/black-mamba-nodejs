Auth Endpoint Contract (proposed)

Magic Link
- POST `/auth/magic/request`
  - Body: `{ email: string }`
  - Behavior:
    - Dev: returns `{ ok: true, url, token }` and logs.
    - Prod: sends email and returns `{ ok: true }`.
  - Status: 200 always (to avoid email enumeration).

- GET `/auth/magic/callback?token=...`
  - Behavior:
    - Verifies token; on success, sets session user `{ id, email }`.
    - On failure, returns 400.
  - Response (JSON): `{ ok: true, user: { id, email } }`.

Protected Route
- GET `/me`
  - Behavior: returns 200 with `{ id, email }` when signed in; otherwise 401.

WebAuthn
- GET `/auth/webauthn/register/options`
  - Behavior:
    - Requires session user.
    - Generates PublicKeyCredentialCreationOptions; stores `challenge` tied to session.
  - Response: `{ publicKey, challenge }` (binary fields base64url or Buffer per lib expectations).

- POST `/auth/webauthn/register/verify`
  - Body: `{ id, rawId, response, type, clientExtensionResults }` (as produced by navigator.credentials.create())
  - Behavior:
    - Verifies attestation using stored challenge; on success stores credential (user binding, publicKey, signCount, transports).
  - Response: `{ ok: true }`.

- GET `/auth/webauthn/login/options`
  - Behavior:
    - Derives `allowCredentials` from stored credentials for users matching `email` query or session user.
    - Stores challenge.
  - Response: `{ publicKey, challenge }`.

- POST `/auth/webauthn/login/verify`
  - Body: assertion result from navigator.credentials.get()
  - Behavior: verifies using stored credential; sets (or refreshes) session.
  - Response: `{ ok: true, user: { id, email } }`.

Notes
- In dev/test, binary fields can be represented as base64url strings. The server will accept these and convert appropriately for the verification helpers.

