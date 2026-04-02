import { writeFile, appendFile, access, mkdir } from "fs/promises";
import { join, dirname } from "path";
import { env } from "../config/env.js";
import { parseMarkdownFile } from "./parser.js";
import { indexChunks } from "./store.js";

/**
 * Write or append content to a note in the Obsidian vault.
 * If the file exists, appends. If not, creates it.
 * After writing, re-indexes the file for search.
 */
export async function writeNote(opts: {
  filename: string;
  content: string;
  append?: boolean;
}): Promise<string> {
  const vaultPath = env.knowledge.vaultPath;
  if (!vaultPath) {
    throw new Error("OBSIDIAN_VAULT_PATH not configured");
  }

  const sanitized = opts.filename.replace(/[<>:"|?*]/g, "_");
  const name = sanitized.endsWith(".md") ? sanitized : `${sanitized}.md`;
  const filePath = join(vaultPath, name);

  await mkdir(dirname(filePath), { recursive: true });

  const exists = await access(filePath).then(() => true).catch(() => false);

  if (exists && opts.append !== false) {
    await appendFile(filePath, `\n\n${opts.content}`, "utf-8");
  } else {
    await writeFile(filePath, opts.content, "utf-8");
  }

  try {
    const chunks = await parseMarkdownFile(filePath);
    await indexChunks(chunks);
  } catch {
    // Non-fatal: note is saved even if re-indexing fails
  }

  const action = exists && opts.append !== false ? "Appended to" : "Created";
  return `${action} note: ${name}`;
}
