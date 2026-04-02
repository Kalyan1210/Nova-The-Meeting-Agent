import { EventEmitter } from "events";

/**
 * Simple energy-based Voice Activity Detection.
 *
 * Buffers incoming PCM audio frames and emits a 'segment' event
 * when a period of silence is detected after speech, indicating
 * a complete utterance ready for transcription.
 *
 * For production, consider replacing with a neural VAD like Silero VAD.
 */
export class VoiceActivityDetector extends EventEmitter {
  private buffer: Buffer[] = [];
  private isSpeaking = false;
  private silenceFrames = 0;

  private readonly energyThreshold: number;
  private readonly silenceFramesRequired: number;
  private readonly sampleRate: number;
  private readonly frameDurationMs: number;

  constructor(opts?: {
    energyThreshold?: number;
    silenceDurationMs?: number;
    sampleRate?: number;
    frameDurationMs?: number;
  }) {
    super();
    this.energyThreshold = opts?.energyThreshold ?? 500;
    this.sampleRate = opts?.sampleRate ?? 16000;
    this.frameDurationMs = opts?.frameDurationMs ?? 20;
    const silenceDurationMs = opts?.silenceDurationMs ?? 800;
    this.silenceFramesRequired = Math.ceil(
      silenceDurationMs / this.frameDurationMs
    );
  }

  /**
   * Feed a PCM 16-bit LE audio frame into the detector.
   */
  processFrame(frame: Buffer): void {
    const energy = this.computeEnergy(frame);

    if (energy > this.energyThreshold) {
      this.isSpeaking = true;
      this.silenceFrames = 0;
      this.buffer.push(frame);
    } else if (this.isSpeaking) {
      this.silenceFrames++;
      this.buffer.push(frame);

      if (this.silenceFrames >= this.silenceFramesRequired) {
        const segment = Buffer.concat(this.buffer);
        this.buffer = [];
        this.isSpeaking = false;
        this.silenceFrames = 0;
        this.emit("segment", segment);
      }
    }
  }

  private computeEnergy(frame: Buffer): number {
    let sum = 0;
    for (let i = 0; i < frame.length - 1; i += 2) {
      const sample = frame.readInt16LE(i);
      sum += sample * sample;
    }
    return Math.sqrt(sum / (frame.length / 2));
  }
}
