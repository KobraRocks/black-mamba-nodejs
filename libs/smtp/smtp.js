import tls from "tls";
import crypto from "crypto";
import { Buffer } from "buffer";

class MailerError extends Error {
  constructor(message) {
    super(message);
    this.name = "MailerError";
  }

  connectionFailed() {
    return this.message.startsWith("Failed to establish connection");
  }

  connectionClosed() {
    return this.message.startsWith("Connection closed unexpectedly");
  }

  authenticationFailed() {
    return this.message.startsWith("Authentication failed");
  }

  ehloFailed() {
    return this.message.startsWith("EHLO command failed");
  }

  mailFromFailed() {
    return this.message.startsWith("MAIL FROM command failed");
  }

  rcptToFailed() {
    return this.message.startsWith("RCPT TO command failed");
  }

  dataFailed() {
    return this.message.startsWith("DATA command failed");
  }

  messageSendingFailed() {
    return this.message.startsWith("Message sending failed");
  }

  quitFailed() {
    return this.message.startsWith("QUIT command failed");
  }

  invalidServerGreeting() {
    return this.message.startsWith("Invalid server greeting");
  }

  invalidResponse() {
    return this.message.startsWith("Invalid response");
  }

  invalidCommand() {
    return this.message.startsWith("Invalid command");
  }
}

function generateUUID() {
  return crypto.randomUUID();
}

function encodeBase64(buffer) {
  return Buffer.from(buffer).toString("base64");
}

function validateResponse(response, expectedCode, errorType) {
  if (!response.startsWith(expectedCode)) {
    throw new MailerError(
      `Invalid response: Expected ${expectedCode}, got ${response.slice(0, 3)}`,
    );
  }
}

function loadEnvConfig(overrides = {}) {
  const env = process.env || {};
  const host = overrides.host || env.BM_SMTP_HOST || "";
  const portRaw = overrides.port ?? env.BM_SMTP_PORT;
  const port = portRaw ? Number(portRaw) : 465;
  const username = overrides.username || env.BM_SMTP_USERNAME || env.BM_SMTP_USER || "";
  const password = overrides.password || env.BM_SMTP_PASSWORD || env.BM_SMTP_PASS || "";
  if (!host) throw new MailerError("Missing BM_SMTP_HOST in environment");
  if (!port || Number.isNaN(port)) throw new MailerError("Missing or invalid BM_SMTP_PORT in environment");
  return { host: String(host).trim(), port, username, password };
}

async function createConnection(host = "", port = 0) {
  return new Promise((resolve, reject) => {
    const conn = tls.connect(port, host, {}, () => {
      if (conn.authorized || !conn.authorizationError) {
        resolve(conn);
      } else {
        reject(
          new MailerError(
            `Failed to establish connection: ${conn.authorizationError}`,
          ),
        );
      }
    });

    conn.on("error", (err) => {
      reject(new MailerError(`Failed to establish connection: ${err.message}`));
    });
  });
}

async function sendCommand(conn, command = "") {
  if (!command.match(/^[A-Z]+(?:\s+[^\r\n]*)?$/i)) {
    throw new MailerError(`Invalid command: ${command}`);
  }

  return new Promise((resolve, reject) => {
    const responseChunks = [];
    const onData = (data) => {
      const response = data.toString();
      conn.removeListener("data", onData);
      console.debug(`SMTP > ${command}`);
      console.debug(`SMTP < ${response.trim()}`);
      resolve(response);
    };

    conn.on("data", onData);
    conn.write(command + "\r\n");
  });
}

async function authenticate(conn, username = "", password = "") {
  const authString = `\u0000${username}\u0000${password}`;
  const authData = encodeBase64(authString);
  const response = await sendCommand(conn, `AUTH PLAIN ${authData}`);

  if (!response.startsWith("235")) {
    throw new MailerError("Authentication failed");
  }
}

function randomBoundary(prefix = 'boundary') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function bufferFrom(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);
  return Buffer.from(String(data), 'utf8');
}

function base64Wrap(buf, lineLength = 76) {
  const b64 = buf.toString('base64');
  const out = [];
  for (let i = 0; i < b64.length; i += lineLength) out.push(b64.slice(i, i + lineLength));
  return out.join('\r\n');
}

export function buildMessage(message = {}, hostForMessageId = "localhost") {
  const date = new Date().toUTCString();
  const messageId = `<${generateUUID()}@${hostForMessageId}>`;
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to}`,
    `Subject: ${message.subject || ''}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    "MIME-Version: 1.0",
  ];

  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  let body;
  if (attachments.length > 0) {
    const mixedBoundary = randomBoundary('mixed');
    const parts = [];
    // First part: either alternative or single text/html
    if (message.text && message.html) {
      const altBoundary = randomBoundary('alt');
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        '',
        `--${altBoundary}`,
        'Content-Type: text/plain; charset="utf-8"',
        '',
        message.text,
        '',
        `--${altBoundary}`,
        'Content-Type: text/html; charset="utf-8"',
        '',
        message.html,
        '',
        `--${altBoundary}--`
      );
    } else {
      parts.push(
        `--${mixedBoundary}`,
        (message.html
          ? 'Content-Type: text/html; charset="utf-8"'
          : 'Content-Type: text/plain; charset="utf-8"'),
        '',
        message.html || message.text || ''
      );
    }
    // Attachments
    for (const att of attachments) {
      const filename = att.filename || 'attachment';
      const ct = att.contentType || 'application/octet-stream';
      const data = bufferFrom(att.content || '');
      const b64 = base64Wrap(data);
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${ct}; name="${filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${filename}"`,
        '',
        b64
      );
    }
    parts.push(`--${mixedBoundary}--`);
    body = [
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      ...parts
    ].join('\r\n');
  } else if (message.text && message.html) {
    const boundary = randomBoundary('alt');
    body = [
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      '',
      message.text,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      '',
      message.html,
      '',
      `--${boundary}--`,
    ].join('\r\n');
  } else {
    body = [
      (message.html
        ? 'Content-Type: text/html; charset="utf-8"'
        : 'Content-Type: text/plain; charset="utf-8"'),
      '',
      message.html || message.text || '',
    ].join('\r\n');
  }
  const content = [...headers, body, "."].join("\r\n");
  return { headers, body, content };
}

export function dotStuff(contentWithTerminator) {
  const lines = String(contentWithTerminator).split('\r\n');
  const n = lines.length;
  if (n === 0) return contentWithTerminator;
  for (let i = 0; i < n; i++) {
    // Do not stuff the final terminator line which must be exactly '.'
    const isLast = i === n - 1;
    if (isLast && lines[i] === '.') continue;
    if (lines[i].startsWith('.')) lines[i] = '.' + lines[i];
  }
  return lines.join('\r\n');
}

export async function sendMail(
  message = {
    from: "",
    to: "",
    subject: "",
    text: "",
    html: "",
  },
  overrides = {},
) {
  const config = loadEnvConfig(overrides);
  const conn = await createConnection(config.host, config.port);

  return new Promise((resolve) => {
    const buffer = [];

    conn.once("data", async (data) => {
      const greeting = data.toString();
      console.debug(`SMTP < ${greeting.trim()}`);

      try {
        if (!greeting.startsWith("220")) {
          throw new MailerError("Invalid server greeting");
        }

        let response = await sendCommand(conn, `EHLO localhost`);
        validateResponse(response, "250", "EHLO command failed");

        if (config.username || config.password) {
          await authenticate(conn, config.username, config.password);
        }

        response = await sendCommand(conn, `MAIL FROM:<${message.from}>`);
        validateResponse(response, "250", "MAIL FROM command failed");

        response = await sendCommand(conn, `RCPT TO:<${message.to}>`);
        validateResponse(response, "250", "RCPT TO command failed");

        response = await sendCommand(conn, `DATA`);
        validateResponse(response, "354", "DATA command failed");

        const { content } = buildMessage(message, config.host);
        const stuffed = dotStuff(content);

        // const content = [
        //   `From: ${message.from}`,
        //   `To: ${message.to}`,
        //   `Subject: ${message.subject}`,
        //   `Date: ${date}`,
        //   `Message-ID: ${messageId}`,
        //   "MIME-Version: 1.0",
        //   message.html
        //     ? "Content-Type: text/html; charset=utf-8"
        //     : "Content-Type: text/plain; charset=utf-8",
        //   "",
        //   message.html || message.text || "",
        //   ".",
        // ].join("\r\n");

        const onFinalResponse = (data) => {
          const finalResponse = data.toString();
          conn.removeListener("data", onFinalResponse);
          console.debug(`SMTP < ${finalResponse.trim()}`);
          validateResponse(finalResponse, "250", "Message sending failed");

          sendCommand(conn, "QUIT").then((quitResponse) => {
            validateResponse(quitResponse, "221", "QUIT command failed");
            conn.end();
            resolve({ result: true });
          }).catch((error) => {
            conn.end();
            resolve({ error });
          });
        };

        conn.on("data", onFinalResponse);
        conn.write(stuffed + "\r\n");
      } catch (error) {
        conn.end();
        resolve({ error });
      }
    });
  });
}

export { MailerError, loadEnvConfig };
