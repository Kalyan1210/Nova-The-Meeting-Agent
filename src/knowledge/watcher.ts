import { watch } from "fs";
import { extname } from "path";
import { parseMarkdownFile } from "./parser.js";
import { indexChunks } from "./store.js";

/**
 * Watch an Obsidian vault directory for file changes and
 * incrementally re-index modified markdown files.
 */
export function watchVault(vaultPath: string): void {
  console.log(`[VaultWatcher] Watching for changes: ${vaultPath}`);

  const debounceMs = 2000;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();

  watch(vaultPath, { recursive: true }, (_eventType, filename) => {
    if (!filename || extname(filename) !== ".md") return;
    if (filename.startsWith(".")) return;

    const fullPath = `${vaultPath}/${filename}`;

    const existing = pending.get(fullPath);
    if (existing) clearTimeout(existing);

    pending.set(
      fullPath,
      setTimeout(async () => {
        pending.delete(fullPath);
        try {
          console.log(`[VaultWatcher] Re-indexing: ${filename}`);
          const chunks = await parseMarkdownFile(fullPath);
          await indexChunks(chunks);
        } catch (err) {
          console.error(`[VaultWatcher] Error re-indexing ${filename}:`, err);
        }
      }, debounceMs)
    );
  });
}
