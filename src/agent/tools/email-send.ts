import { google } from "googleapis";
import { createOAuth2Client } from "../../config/google-auth.js";

export interface SendEmailOptions {
  to: string[];
  subject: string;
  body: string;
  cc?: string[];
}

/**
 * Send an email via Gmail.
 * The message is composed as plain text in RFC 2822 format and
 * base64url-encoded before being handed to the Gmail API.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth: createOAuth2Client() });

  const toHeader = opts.to.join(", ");
  const ccHeader = opts.cc?.length ? `Cc: ${opts.cc.join(", ")}\r\n` : "";

  const raw = [
    `To: ${toHeader}`,
    `${ccHeader}Subject: ${opts.subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    opts.body,
  ].join("\r\n");

  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });

  return `Email sent successfully (message ID: ${res.data.id}).`;
}
