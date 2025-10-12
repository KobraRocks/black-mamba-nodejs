import tls from "tls";
import crypto from "crypto";
import { Buffer } from "buffer";
import { TextDecoder, TextEncoder } from "util";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

export async function sendMail(
  config = {
    host: "",
    port: 0,
    username: "",
    password: "",
  },
  message = {
    from: "",
    to: "",
    subject: "",
    text: "",
    html: "",
  },
) {
  const conn = await createConnection(config.host.trim(), config.port);

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

        await authenticate(conn, config.username, config.password);

        response = await sendCommand(conn, `MAIL FROM:<${message.from}>`);
        validateResponse(response, "250", "MAIL FROM command failed");

        response = await sendCommand(conn, `RCPT TO:<${message.to}>`);
        validateResponse(response, "250", "RCPT TO command failed");

        response = await sendCommand(conn, `DATA`);
        validateResponse(response, "354", "DATA command failed");

        const date = new Date().toUTCString();
        const messageId = `<${generateUUID()}@${config.host}>`;

        const headers = [
          `From: ${message.from}`,
          `To: ${message.to}`,
          `Subject: ${message.subject}`,
          `Date: ${date}`,
          `Message-ID: ${messageId}`,
          "MIME-Version: 1.0",
        ];

        let body;
        if (message.text && message.html) {
          const boundary = "boundary42";
          body = [
            'Content-Type: multipart/alternative; boundary="' + boundary + '"',
            "",
            "--" + boundary,
            'Content-Type: text/plain; charset="utf-8"',
            "",
            message.text,
            "",
            "--" + boundary,
            'Content-Type: text/html; charset="utf-8"',
            "",
            message.html,
            "",
            "--" + boundary + "--",
          ].join("\r\n");
        } else {
          body = [
            message.html
              ? 'Content-Type: text/html; charset="utf-8"'
              : 'Content-Type: text/plain; charset="utf-8"',
            "",
            message.html || message.text || "",
          ].join("\r\n");
        }

        const content = [...headers, body, ".",].join("\r\n");

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
        conn.write(content + "\r\n");
      } catch (error) {
        conn.end();
        resolve({ error });
      }
    });
  });
}
