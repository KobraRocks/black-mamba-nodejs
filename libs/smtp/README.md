SMTP (ESM, Zero‑dep)

Small SMTP client with TLS that sends simple text/HTML emails without external dependencies. Reads SMTP configuration from environment variables — no config object is required.

Environment
- `BM_SMTP_HOST` (string) — SMTP server hostname
- `BM_SMTP_PORT` (number) — server port (e.g., 465 for SMTPS)
- `BM_SMTP_USERNAME` or `BM_SMTP_USER` (string, optional) — username
- `BM_SMTP_PASSWORD` or `BM_SMTP_PASS` (string, optional) — password

Exports
- `sendMail(message, overrides?) => Promise<{ result: true } | { error: Error }>`
- `buildMessage(message, hostForMessageId?) => { headers: string[], body: string, content: string }`
- `loadEnvConfig(overrides?) => { host: string, port: number, username: string, password: string }`
- `MailerError` — custom error class (with helper predicates)
- `dotStuff(contentWithTerminator) => string` — applies SMTP dot‑stuffing to DATA lines (leaves final `.` terminator intact)

Quick Start (sendMail)
```js
import { sendMail } from './libs/smtp/index.js';

// Ensure env: BM_SMTP_HOST, BM_SMTP_PORT, BM_SMTP_USERNAME, BM_SMTP_PASSWORD (if auth needed)
const res = await sendMail({
  from: 'no-reply@example.com',
  to: 'user@example.com',
  subject: 'Hello',
  text: 'Hi there',
  html: '<p>Hi there</p>'
});

if (res.result) {
  console.log('Sent');
} else {
  console.error('Failed:', res.error);
}
```

sendMail(message, overrides?)
- Input message fields:
  - `from` string Email (e.g., `no-reply@example.com`).
  - `to` string Email or address list (single address supported in current implementation).
  - `subject?` string
  - `text?` string Plain text body.
  - `html?` string HTML body.
- Overrides (optional, for tests/local overrides): `{ host, port, username, password }` — takes precedence over env.
- Behavior:
  - Connects via implicit TLS (`tls.connect`) to `SMTP_HOST:SMTP_PORT`.
  - Issues `EHLO` and authenticates with `AUTH PLAIN` if credentials are present.
  - If both `text` and `html` are present, sends `multipart/alternative`; otherwise uses a single part (`text/plain` or `text/html`).
  - Sends `MAIL FROM`, `RCPT TO`, `DATA`, then `QUIT`.

Attachments
- Provide an `attachments` array on the message. Each item supports:
  - `filename` string (required)
  - `content` Buffer | Uint8Array | string (required)
  - `contentType?` string (default: `application/octet-stream`)
- Attachments are encoded as base64 and sent in a `multipart/mixed` message. If both `text` and `html` are present, the body is a `multipart/alternative` nested inside the `multipart/mixed`.

Example with attachments
```js
await sendMail({
  from: 'no-reply@example.com',
  to: 'user@example.com',
  subject: 'Invoice',
  text: 'See attached PDF',
  attachments: [
    { filename: 'invoice.pdf', contentType: 'application/pdf', content: Buffer.from(pdfBytes) },
    { filename: 'notes.txt', content: 'Thanks for your business' }
  ]
});
```

Example with overrides (useful in tests)
```js
import { sendMail } from './libs/smtp/index.js';

await sendMail(
  { from: 'a@example.com', to: 'b@example.com', subject: 'Test', text: 'ok' },
  { host: 'smtp.example.com', port: 465, username: 'u', password: 'p' }
);
```

buildMessage(message, hostForMessageId?)
- Returns prebuilt headers/body/content string (terminates with `.` as required by SMTP DATA).
- Useful for unit tests and custom transports.
 - Also supports `attachments` as described above; will construct `multipart/mixed` with nested `multipart/alternative` when needed.
```js
import { buildMessage } from './libs/smtp/index.js';

const { headers, body, content } = buildMessage({
  from: 'a@example.com',
  to: 'b@example.com',
  subject: 'Hello',
  text: 'Plain',
  html: '<b>Bold</b>'
}, 'example.com');

console.log(headers.join('\n'));
console.log(body);
console.log(content); // ready to write after SMTP DATA
```

loadEnvConfig(overrides?)
- Reads `BM_SMTP_HOST`, `BM_SMTP_PORT`, and optional credentials from environment.
- Throws `MailerError` if `BM_SMTP_HOST` or `BM_SMTP_PORT` are missing/invalid.
- `overrides` merges on top of env (for tests or per-call differences).
```js
import { loadEnvConfig } from './libs/smtp/index.js';

process.env.BM_SMTP_HOST = 'smtp.example.com';
process.env.BM_SMTP_PORT = '465';
const cfg = loadEnvConfig();
// { host: 'smtp.example.com', port: 465, username: '', password: '' }

const cfg2 = loadEnvConfig({ port: 2465 });
// { host: 'smtp.example.com', port: 2465, ... }
```

MailerError
- Custom error for consistent messages and type checking.
- You can use the instance type and/or message text to branch logic.
```js
import { sendMail, MailerError } from './libs/smtp/index.js';

const r = await sendMail({ from: 'a@x', to: 'b@y', subject: 'Hi', text: '...' });
if (!r.result) {
  if (r.error instanceof MailerError) {
    // Inspect the message prefix or display a friendly log
    if (r.error.connectionFailed?.()) {
      console.error('SMTP connection failed');
    } else if (r.error.authenticationFailed?.()) {
      console.error('SMTP authentication failed');
    } else {
      console.error('Mailer error:', r.error.message);
    }
  } else {
    console.error('Unexpected error:', r.error);
  }
}
```

Notes
- TLS only (implicit TLS like port 465). STARTTLS is not implemented.
- Authentication is attempted only if username/password are provided.
- Message IDs use a UUID and the SMTP host for uniqueness.
- SMTP DATA is dot‑stuffed automatically when sending; exported `dotStuff()` can be used for validation in tests.

Testing
- This repo avoids network use in tests. Use `buildMessage()` and `loadEnvConfig()` for unit tests.
- Run: `npm run test:smtp`
