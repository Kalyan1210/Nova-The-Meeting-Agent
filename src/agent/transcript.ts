/**
 * Rolling transcript buffer that maintains the last N minutes
 * of conversation for context.
 */
export class TranscriptBuffer {
  private entries: Array<{ timestamp: Date; speaker: string; text: string }> =
    [];
  private maxAgeMs: number;

  constructor(maxAgeMinutes = 30) {
    this.maxAgeMs = maxAgeMinutes * 60_000;
  }

  add(speaker: string, text: string): void {
    this.entries.push({ timestamp: new Date(), speaker, text });
    this.prune();
  }

  private prune(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    this.entries = this.entries.filter((e) => e.timestamp.getTime() > cutoff);
  }

  /**
   * Format the transcript as a string suitable for LLM context.
   */
  format(): string {
    this.prune();
    if (this.entries.length === 0) return "(No conversation yet)";

    return this.entries
      .map((e) => {
        const time = e.timestamp.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        return `[${time}] ${e.speaker}: ${e.text}`;
      })
      .join("\n");
  }

  get length(): number {
    return this.entries.length;
  }
}
