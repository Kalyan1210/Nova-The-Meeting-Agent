import { connect, Table } from "@lancedb/lancedb";
import { DIMENSIONS, embed, embedBatch } from "./embeddings.js";
import { DocumentChunk } from "./parser.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_DIR = resolve(__dirname, "../../.lancedb");
const TABLE_NAME = "knowledge_chunks";

interface StoredChunk {
  [key: string]: unknown;
  id: string;
  filePath: string;
  fileName: string;
  heading: string;
  content: string;
  headingLevel: number;
  vector: number[];
}

let _table: Table | null = null;

async function getTable(): Promise<Table> {
  if (_table) return _table;
  const db = await connect(DB_DIR);
  const tables = await db.tableNames();
  if (tables.includes(TABLE_NAME)) {
    _table = await db.openTable(TABLE_NAME);
  }
  return _table!;
}

/**
 * Index a set of document chunks: generate embeddings and upsert into LanceDB.
 */
export async function indexChunks(chunks: DocumentChunk[]): Promise<void> {
  if (chunks.length === 0) return;

  console.log(`[KnowledgeStore] Embedding ${chunks.length} chunks...`);
  const vectors = await embedBatch(chunks.map((c) => c.content));

  const rows: StoredChunk[] = chunks.map((chunk, i) => ({
    ...chunk,
    vector: vectors[i],
  }));

  const db = await connect(DB_DIR);
  const tables = await db.tableNames();

  if (tables.includes(TABLE_NAME)) {
    const table = await db.openTable(TABLE_NAME);
    await table.add(rows);
    _table = table;
  } else {
    _table = await db.createTable(TABLE_NAME, rows);
  }

  console.log(`[KnowledgeStore] Indexed ${rows.length} chunks.`);
}

/**
 * Search the knowledge base for chunks most relevant to the query.
 */
export async function searchKnowledge(
  query: string,
  topK = 5
): Promise<Array<{ content: string; filePath: string; heading: string; score: number }>> {
  const table = await getTable();
  if (!table) {
    console.warn("[KnowledgeStore] No indexed data. Run `npm run index-vault` first.");
    return [];
  }

  const queryVec = await embed(query);
  const results = await table.search(queryVec).limit(topK).toArray();

  return results.map((row: Record<string, unknown>) => ({
    content: row["content"] as string,
    filePath: row["filePath"] as string,
    heading: row["heading"] as string,
    score: row["_distance"] as number,
  }));
}

/**
 * Drop and recreate the index (for full re-indexing).
 */
export async function resetIndex(): Promise<void> {
  const db = await connect(DB_DIR);
  const tables = await db.tableNames();
  if (tables.includes(TABLE_NAME)) {
    await db.dropTable(TABLE_NAME);
  }
  _table = null;
  console.log("[KnowledgeStore] Index cleared.");
}
