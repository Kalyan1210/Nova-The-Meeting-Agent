import { env } from "../config/env.js";

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

async function ttsRequest(voiceId: string, text: string): Promise<Response> {
  return fetch(`${ELEVENLABS_BASE}/text-to-speech/${voiceId}/stream`, {
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
}

/**
 * Convert text to speech using ElevenLabs streaming API.
 * Automatically falls back to ELEVENLABS_FALLBACK_VOICE_ID when the
 * primary voice returns 402 (paid-tier library voice on a free account).
 * Returns raw audio bytes (mpeg) suitable for playback or WebRTC injection.
 */
export async function synthesizeSpeech(text: string): Promise<Buffer> {
  let response = await ttsRequest(env.elevenlabs.voiceId, text);

  if (response.status === 402 && env.elevenlabs.fallbackVoiceId !== env.elevenlabs.voiceId) {
    console.warn("[TTS] Primary voice returned 402 — falling back to free-tier voice.");
    response = await ttsRequest(env.elevenlabs.fallbackVoiceId, text);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${body}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
