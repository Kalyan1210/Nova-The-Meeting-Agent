import { readFile } from "fs/promises";
import { basename } from "path";

export interface DocumentChunk {
  id: string;
  filePath: string;
  fileName: string;
  heading: string;
  content: string;
  headingLevel: number;
}

/**
 * Parse an Obsidian markdown file into chunks split at heading boundaries.
 * Each chunk includes the heading hierarchy for context.
 */
export async function parseMarkdownFile(
  filePath: string
): Promise<DocumentChunk[]> {
  const raw = await readFile(filePath, "utf-8");
  const fileName = basename(filePath, ".md");
  const lines = raw.split("\n");
  const chunks: DocumentChunk[] = [];

  let currentHeading = fileName;
  let currentLevel = 0;
  let currentLines: string[] = [];
  let chunkIndex = 0;

  function flush() {
    const content = currentLines.join("\n").trim();
    if (content.length > 0) {
      chunks.push({
        id: `${filePath}#${chunkIndex}`,
        filePath,
        fileName,
        heading: currentHeading,
        content,
        headingLevel: currentLevel,
      });
      chunkIndex++;
    }
    currentLines = [];
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentLevel = headingMatch[1].length;
      currentHeading = headingMatch[2].trim();
    }
    currentLines.push(line);
  }
  flush();

  return chunks;
}
