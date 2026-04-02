/**
 * One-time OAuth 2.0 setup helper.
 * Starts a local HTTP server, opens the Google consent flow in the browser,
 * and automatically captures the authorization code via redirect.
 *
 * Usage: npm run oauth-setup
 */

import { google } from "googleapis";
import http from "http";
import { URL } from "url";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/meetings.space.readonly",
];

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env before running this script."
    );
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  const code = await new Promise<string>((resolveCode, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url?.startsWith("/oauth2callback")) {
        res.writeHead(404);
        res.end();
        return;
      }

      const parsed = new URL(req.url, `http://localhost:${PORT}`);
      const authCode = parsed.searchParams.get("code");
      const error = parsed.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`<h2>Authorization failed</h2><p>Error: ${error}</p><p>You can close this tab.</p>`);
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }

      if (!authCode) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h2>Missing authorization code</h2><p>You can close this tab.</p>");
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h2>Authorization successful!</h2><p>You can close this tab and return to the terminal.</p>");
      server.close();
      resolveCode(authCode);
    });

    server.listen(PORT, () => {
      console.log(`\nLocal callback server listening on port ${PORT}`);
      console.log("\nOpen this URL in your browser and sign in:\n");
      console.log(authUrl);
      console.log("\nWaiting for authorization...\n");
    });

    server.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Close whatever is using it and try again.`);
      }
      reject(err);
    });
  });

  const { tokens } = await oauth2.getToken(code);

  console.log("Authorization successful!\n");
  console.log("Add this to your .env file:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error("OAuth setup failed:", err.message ?? err);
  process.exit(1);
});
