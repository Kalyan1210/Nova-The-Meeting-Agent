import OpenAI from "openai";
import { Readable } from "stream";
import { env } from "../config/env.js";

const openai = new OpenAI({ apiKey: env.openai.apiKey });

const TTS_INSTRUCTIONS =
  "Speak naturally and conversationally, as if you're a friendly AI assistant " +
  "participating in a live video meeting. Be warm and clear. Keep energy calm but engaged. " +
  "Do not add filler sounds — speak directly and confidently.";

/**
 * Synthesize speech and return a complete MP3 buffer.
 * Kept for chat-channel responses where streaming is unnecessary.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const response = await (openai.audio.speech as any).create({
    model: "gpt-4o-mini-tts",
    voice: "nova",
    input: text,
    response_format: "mp3",
    instructions: TTS_INSTRUCTIONS,
  });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Stream speech as raw PCM chunks (24 kHz, 16-bit, mono, little-endian).
 * First chunk arrives in ~100ms — audio starts before synthesis finishes.
 */
export async function* streamSpeech(text: string): AsyncGenerator<Buffer> {
  const response = await (openai.audio.speech as any).create({
    model: "gpt-4o-mini-tts",
    voice: "nova",
    input: text,
    response_format: "pcm",
    instructions: TTS_INSTRUCTIONS,
  });

  const nodeStream = Readable.fromWeb(
    response.body as import("stream/web").ReadableStream<Uint8Array>
  );

  for await (const chunk of nodeStream) {
    yield chunk as Buffer;
  }
}
