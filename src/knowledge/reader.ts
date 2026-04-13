import { readFile, readdir } from "fs/promises";
import { join, extname, basename } from "path";
import { env } from "../config/env.js";

/**
 * Read the contents of a single note from the Obsidian vault by filename.
 * The .md extension is optional — it will be added if missing.
 * Returns the raw markdown content.
 */
export async function readNote(filename: string): Promise<string> {
  const vaultPath = env.knowledge.vaultPath;
  if (!vaultPath) {
    throw new Error("OBSIDIAN_VAULT_PATH is not configured.");
  }

  const name = filename.endsWith(".md") ? filename : `${filename}.md`;
  const filePath = join(vaultPath, name);

  try {
    return await readFile(filePath, "utf-8");
  } catch {
    throw new Error(`Note not found: ${name}`);
  }
}

/**
 * List all markdown note filenames in the vault (top-level only).
 * Useful when Nova needs to tell users what notes are available.
 */
export async function listNotes(): Promise<string[]> {
  const vaultPath = env.knowledge.vaultPath;
  if (!vaultPath) {
    throw new Error("OBSIDIAN_VAULT_PATH is not configured.");
  }

  const entries = await readdir(vaultPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && extname(e.name) === ".md")
    .map((e) => basename(e.name, ".md"))
    .sort();
}
