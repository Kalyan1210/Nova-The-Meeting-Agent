import { env } from "../config/env.js";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

/**
 * Convert text to speech using ElevenLabs streaming API.
 * Returns raw audio bytes (mpeg) suitable for playback or WebRTC injection.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  const url = `${ELEVENLABS_BASE}/text-to-speech/${env.elevenlabs.voiceId}/stream`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": env.elevenlabs.apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
