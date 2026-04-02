import OpenAI from "openai";
import { env } from "../config/env.js";

const openai = new OpenAI({ apiKey: env.openai.apiKey });

/**
 * Transcribe an audio segment using OpenAI's Whisper API.
 *
 * Expects audio as a Buffer (wav/webm/mp3/mp4/m4a).
 * Returns the transcribed text.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  format: "wav" | "webm" | "mp3" = "wav"
): Promise<string> {
  const file = new File([new Uint8Array(audioBuffer)], `segment.${format}`, {
    type: `audio/${format}`,
  });

  const response = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    response_format: "text",
  });

  return response as unknown as string;
}
