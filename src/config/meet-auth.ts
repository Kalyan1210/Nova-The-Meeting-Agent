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

  console.log("  Sign in, then wait for Meet homepage to fully load.");
  console.log("  Cookies are saved automatically — just close the window when done.\n");

  // Save cookies immediately once Meet's homepage finishes loading (after sign-in redirect).
  // This fires regardless of whether the user closes a tab or the whole browser.
  let saved = false;

  const trySave = async (label: string) => {
    if (saved) return;
    const cookies = await context.cookies().catch(() => []);
    if (cookies.length === 0) return;
    saved = true;
    await saveCookies(cookies);
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Done! ${cookies.length} session cookies saved (${label}).`);
    console.log("  Nova can now join meetings headlessly.");
    console.log("  You can close the browser and press Ctrl+C to exit.");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
  };

  // Fire on every full navigation so we catch the post-login redirect
  page.on("load", () => trySave("page load").catch(() => {}));

  // Also fire when tab or browser closes (original behaviour)
  page.on("close", () => trySave("tab close").catch(() => {}));
  browser.on("disconnected", () => trySave("browser close").catch(() => {}));

  await new Promise<void>((resolve) => {
    browser.on("disconnected", () => resolve());
    // Also resolve if process is interrupted so cookies are flushed
    process.on("SIGINT", () => {
      trySave("SIGINT").finally(() => resolve());
    });
  });
}

main().catch((err) => {
  console.error("meet-auth failed:", err.message ?? err);
  process.exit(1);
});
