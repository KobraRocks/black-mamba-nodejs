Proposed Data Models

users
- id: INTEGER PK
- email: TEXT NOT NULL UNIQUE
- public_id: TEXT NOT NULL UNIQUE           // exposed identifier for booking links
- created_at: TEXT NOT NULL
- updated_at: TEXT NOT NULL

webauthn_credentials
- id: INTEGER PK
- user_id: INTEGER NOT NULL REFERENCES users(id)
- credential_id: TEXT NOT NULL UNIQUE           // base64url of credential id
- public_key: TEXT NOT NULL                     // base64 or JWK string
- sign_count: INTEGER NOT NULL DEFAULT 0
- transports: TEXT DEFAULT ''                   // comma-separated string
- created_at: TEXT NOT NULL
- updated_at: TEXT NOT NULL

Indexes
- users(email)
- webauthn_credentials(user_id)
- webauthn_credentials(credential_id)

Model Class Stubs (using ApplicationRecord)
- `User` — already present in `app/models/user.js`, add `email` uniqueness at application level.
- `WebauthnCredential` — new model file `app/models/webauthn_credential.js` with the schema above.
