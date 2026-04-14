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

  console.log("  Sign in to nova@agenticrealm.org in the browser.");
  console.log("  Cookies will be saved automatically once you reach Meet's homepage.\n");

  let saved = false;

  // Google's session identity cookies — only present when signed in.
  // We check for these so we don't save pre-auth cookies by mistake.
  const SESSION_COOKIE_NAMES = new Set([
    "SID", "HSID", "SSID", "APISID", "SAPISID",
    "__Secure-1PSID", "__Secure-3PSID",
  ]);

  const trySave = async (label: string) => {
    if (saved) return;
    const cookies = await context.cookies().catch(() => []);
    const hasSession = cookies.some((c) => SESSION_COOKIE_NAMES.has(c.name));
    if (!hasSession) {
      console.log("  (Not signed in yet — waiting...)");
      return;
    }
    saved = true;
    await saveCookies(cookies);
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Done! ${cookies.length} session cookies saved (${label}).`);
    console.log("  Nova can now join meetings headlessly.");
    console.log("  Close the browser or press Ctrl+C to exit.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  };

  // Check on every page load (catches the post-login redirect back to Meet)
  page.on("load", () => trySave("page load").catch(() => {}));
  page.on("close", () => trySave("tab close").catch(() => {}));
  browser.on("disconnected", () => trySave("browser close").catch(() => {}));

  await new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve());
    process.on("SIGINT", () => {
      trySave("SIGINT").finally(() => resolve());
    });
  });
}

main().catch((err) => {
  console.error("meet-auth failed:", err.message ?? err);
  process.exit(1);
});
