import OpenAI from "openai";
import { env } from "../config/env.js";

const openai = new OpenAI({ apiKey: env.openai.apiKey });

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 1536;

export { DIMENSIONS };

/**
 * Generate an embedding vector for a single text string.
 */
export async function embed(text: string): Promise<number[]> {
  const res = await openai.embeddings.create({
    model: MODEL,
    input: text,
  });
  return res.data[0].embedding;
}

/**
 * Generate embedding vectors for a batch of texts.
 * The OpenAI embeddings API accepts up to ~2048 inputs per call.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const batchSize = 512;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await openai.embeddings.create({
      model: MODEL,
      input: batch,
    });
    for (const item of res.data) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}
