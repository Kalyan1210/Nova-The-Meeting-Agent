/**
 * CLI tool to index an Obsidian vault into the LanceDB vector store.
 * Usage: npm run index-vault
 */

import { readdir, stat } from "fs/promises";
import { join, extname } from "path";
import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

import { parseMarkdownFile, DocumentChunk } from "./parser.js";
import { resetIndex, indexChunks } from "./store.js";

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);

      if (entry.isDirectory()) {
        if (entry.name.startsWith(".")) continue;
        await walk(fullPath);
      } else if (extname(entry.name) === ".md") {
        files.push(fullPath);
      }
    }
  }

  await walk(dir);
  return files;
}

async function main() {
  const vaultPath = process.env.OBSIDIAN_VAULT_PATH;
  if (!vaultPath) {
    console.error("Set OBSIDIAN_VAULT_PATH in .env before running.");
    process.exit(1);
  }

  const vaultStat = await stat(vaultPath).catch(() => null);
  if (!vaultStat) {
    console.error(`Path does not exist: ${vaultPath}`);
    process.exit(1);
  }

  let files: string[];
  if (vaultStat.isFile() && extname(vaultPath) === ".md") {
    console.log(`[Indexer] Indexing single file: ${vaultPath}`);
    files = [vaultPath];
  } else if (vaultStat.isDirectory()) {
    console.log(`[Indexer] Scanning vault at: ${vaultPath}`);
    files = await collectMarkdownFiles(vaultPath);
  } else {
    console.error(`Path is not a directory or .md file: ${vaultPath}`);
    process.exit(1);
  }
  console.log(`[Indexer] Found ${files.length} markdown files.`);

  if (files.length === 0) {
    console.log("[Indexer] Nothing to index.");
    return;
  }

  const allChunks: DocumentChunk[] = [];
  for (const file of files) {
    const chunks = await parseMarkdownFile(file);
    allChunks.push(...chunks);
  }
  console.log(
    `[Indexer] Parsed ${allChunks.length} chunks from ${files.length} files.`
  );

  await resetIndex();
  await indexChunks(allChunks);
  console.log("[Indexer] Done.");
}

main().catch((err) => {
  console.error("[Indexer] Fatal error:", err);
  process.exit(1);
});
