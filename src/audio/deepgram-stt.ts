import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import { EventEmitter } from "events";
import { env } from "../config/env.js";

export interface Utterance {
  speaker: string; // "Speaker 0", "Speaker 1", etc.
  text: string;
}

/**
 * Wraps Deepgram's live transcription WebSocket.
 *
 * Replaces the VAD + Whisper batch pipeline with a single streaming connection
 * that handles segmentation internally and returns speaker-labeled utterances
 * at ~200ms latency.
 *
 * Audio format expected: PCM Int16 LE, 16 kHz, mono (matches what the
 * Playwright bot's RTCPeerConnection intercept sends).
 *
 * Emits:
 *   'utterance'  ({ speaker, text })  — final transcript segment ready
 *   'closed'     ()                   — connection closed
 */
export class DeepgramTranscriber extends EventEmitter {
  private liveConn: any = null;
  private connected = false;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Open the Deepgram WebSocket. Call once per meeting.
   */
  async connect(): Promise<void> {
    const apiKey = env.deepgram.apiKey;
    if (!apiKey) {
      throw new Error(
        "DEEPGRAM_API_KEY is not set. Add it to .env to enable speaker diarization."
      );
    }

    const client = createClient(apiKey);

    this.liveConn = client.listen.live({
      model: "nova-2",
      language: "en",
      smart_format: true,
      diarize: true,
      punctuate: true,
      encoding: "linear16",
      sample_rate: 16000,
      channels: 1,
      interim_results: false,
      // End of speech detection — emit final transcript after 500ms silence
      endpointing: 500,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Deepgram connection timeout")),
        10_000
      );

      this.liveConn.on(LiveTranscriptionEvents.Open, () => {
        clearTimeout(timeout);
        this.connected = true;
        console.log("[Deepgram] Streaming connection open.");
        // Send keepalive every 8s so the connection stays alive
        // even during periods of silence in the meeting.
        this.keepAliveTimer = setInterval(() => {
          if (this.connected && this.liveConn) {
            try {
              this.liveConn.keepAlive();
            } catch {
              // Connection may have dropped — will be caught by Close event
            }
          }
        }, 8_000);
        resolve();
      });

      this.liveConn.on(LiveTranscriptionEvents.Error, (err: unknown) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    this.liveConn.on(
      LiveTranscriptionEvents.Transcript,
      (data: any) => {
        const alt = data.channel?.alternatives?.[0];
        if (!alt?.transcript?.trim()) return;

        // Only process final (non-interim) results
        if (data.is_final === false) return;

        const speakerId: number = alt.words?.[0]?.speaker ?? 0;
        const utterance: Utterance = {
          speaker: `Speaker ${speakerId}`,
          text: alt.transcript.trim(),
        };

        this.emit("utterance", utterance);
      }
    );

    this.liveConn.on(LiveTranscriptionEvents.Close, () => {
      this.connected = false;
      this.stopKeepAlive();
      console.log("[Deepgram] Connection closed.");
      this.emit("closed");
    });

    this.liveConn.on(LiveTranscriptionEvents.Error, (err: unknown) => {
      console.error("[Deepgram] Error:", err);
    });
  }

  /**
   * Feed a PCM audio buffer into Deepgram.
   * Call this for every audio frame received from the meeting bot.
   */
  sendAudio(pcm: Buffer): void {
    if (this.connected && this.liveConn) {
      this.liveConn.send(pcm);
    }
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  /**
   * Gracefully close the Deepgram connection.
   */
  disconnect(): void {
    this.stopKeepAlive();
    if (this.liveConn) {
      try {
        this.liveConn.finish();
      } catch {
        // Ignore close errors
      }
    }
    this.connected = false;
  }
}
