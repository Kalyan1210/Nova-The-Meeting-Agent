import { readFile, writeFile } from "fs/promises";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOKIE_FILE = resolve(__dirname, "../../.nova-session.json");

export async function loadCookies(): Promise<any[]> {
  try {
    const data = await readFile(COOKIE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return [];
  }
}

export async function saveCookies(cookies: any[]): Promise<void> {
  await writeFile(COOKIE_FILE, JSON.stringify(cookies, null, 2), "utf-8");
  console.log(`[CookieStore] Saved ${cookies.length} session cookies.`);
}
