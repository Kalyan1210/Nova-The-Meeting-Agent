import OpenAI from "openai";
import { Readable } from "stream";
import { env } from "../config/env.js";

const openai = new OpenAI({ apiKey: env.openai.apiKey });

/**
 * Synthesize speech and return a complete MP3 buffer.
 * Kept for chat-channel responses where streaming is unnecessary.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: "nova",
    input: text,
    response_format: "mp3",
  });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Stream speech synthesis as raw PCM chunks (24 kHz, 16-bit, mono, little-endian).
 * Yields the first chunk in ~100-200ms so the browser can start playing
 * before synthesis is complete — removes ~400ms of perceived latency vs
 * waiting for the full audio file.
 */
export async function* streamSpeech(text: string): AsyncGenerator<Buffer> {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: "nova",
    input: text,
    response_format: "pcm", // 24 kHz, Int16 LE, mono — no decode needed
  });

  const nodeStream = Readable.fromWeb(
    response.body as import("stream/web").ReadableStream<Uint8Array>
  );

  for await (const chunk of nodeStream) {
    yield chunk as Buffer;
  }
}
