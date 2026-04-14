/**
 * One-time Google Meet browser authentication.
 *
 * Opens a visible Chromium window and waits for you to sign in to Google.
 * Once signed in, the session cookies are saved to .nova-session.json so
 * future runs can join meetings headlessly without re-authenticating.
 *
 * Usage: npm run meet-auth
 */

import { chromium } from "playwright";
import { saveCookies } from "./cookie-store.js";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

async function main() {
  const agentEmail = process.env.AGENT_EMAIL ?? "nova@agenticrealm.org";

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Nova — Google Meet Browser Auth Setup");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`\n  Sign in as: ${agentEmail}`);
  console.log("  Once signed in and you can see Google Meet, close the browser.\n");

  const browser = await chromium.launch({
    headless: false,
    args: ["--start-maximized"],
  });

  const context = await browser.newContext({
    viewport: null,
    permissions: ["camera", "microphone"],
  });

  const page = await context.newPage();
  await page.goto("https://meet.google.com", { waitUntil: "domcontentloaded" });

  await new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve());
    console.log("  Waiting for you to sign in and close the browser...");
  });

  const cookies = await context.cookies().catch(() => []);

  if (cookies.length === 0) {
    console.error("\n  No cookies captured. Did you sign in before closing?");
    process.exit(1);
  }

  await saveCookies(cookies);

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Done! ${cookies.length} session cookies saved.`);
  console.log("  Nova can now join meetings headlessly.");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
}

main().catch((err) => {
  console.error("meet-auth failed:", err.message ?? err);
  process.exit(1);
});
