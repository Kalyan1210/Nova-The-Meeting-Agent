import WebSocket from "ws";
import { EventEmitter } from "events";
import { env } from "../config/env.js";
import { realtimeLog } from "../infra/logger.js";
import type {
  ClientEvent,
  ServerEvent,
  RealtimeSessionConfig,
  ConversationItem,
} from "./types.js";
import { toolRegistry } from "../tools/registry.js";

export type SessionState = "connecting" | "ready" | "responding" | "disconnected";

export interface RealtimeSessionOpts {
  instructions: string;
  onAudioDelta: (audio: Buffer) => void;
  onAudioDone: () => void;
  onTranscript: (text: string, itemId: string) => void;
  onResponseTranscript: (text: string) => void;
  onFunctionCall: (name: string, args: string, callId: string, itemId: string) => void;
  onSpeechStarted: () => void;
  onSpeechStopped: () => void;
  onError: (error: { type: string; code: string; message: string }) => void;
}

const REALTIME_URL = "wss://api.openai.com/v1/realtime";

// Prune conversation items when input tokens exceed this threshold
const CONTEXT_PRUNE_THRESHOLD = 2500;
// Number of oldest items to delete per prune pass
const CONTEXT_PRUNE_BATCH = 8;

export class RealtimeSession extends EventEmitter {
  private ws: WebSocket | null = null;
  private state: SessionState = "disconnected";
  private opts: RealtimeSessionOpts;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  // Ordered list of conversation item IDs for context pruning
  private itemIds: string[] = [];

  constructor(opts: RealtimeSessionOpts) {
    super();
    this.opts = opts;
  }

  getState(): SessionState {
    return this.state;
  }

  async connect(): Promise<void> {
    const model = env.openai.realtimeModel;
    const url = `${REALTIME_URL}?model=${model}`;

    realtimeLog.info({ model }, "connecting to Realtime API");
    this.state = "connecting";

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${env.openai.apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      const timeout = setTimeout(() => {
        reject(new Error("Realtime API connection timeout (15s)"));
        this.ws?.close();
      }, 15_000);

      this.ws.on("open", () => {
        clearTimeout(timeout);
        realtimeLog.info("WebSocket connected");
        this.reconnectAttempts = 0;
        this.configureSession();
        this.startKeepAlive();
        this.state = "ready";
        resolve();
      });

      this.ws.on("message", (data: WebSocket.Data) => {
        try {
          const event = JSON.parse(data.toString()) as ServerEvent;
          this.handleEvent(event);
        } catch (err) {
          realtimeLog.error({ error: String(err) }, "failed to parse server event");
        }
      });

      this.ws.on("close", (code, reason) => {
        clearTimeout(timeout);
        this.stopKeepAlive();
        const wasReady = this.state !== "connecting";
        this.state = "disconnected";
        realtimeLog.warn({ code, reason: reason.toString() }, "WebSocket closed");
        if (wasReady) this.attemptReconnect();
      });

      this.ws.on("error", (err) => {
        realtimeLog.error({ error: err.message }, "WebSocket error");
      });
    });
  }

  disconnect() {
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.maxReconnectAttempts = 0; // prevent auto-reconnect
    if (this.ws) {
      this.ws.close(1000, "client disconnect");
      this.ws = null;
    }
    this.state = "disconnected";
    realtimeLog.info("session disconnected");
  }

  /** Send raw PCM16 24kHz audio to the Realtime API */
  sendAudio(pcm24kHz: Buffer) {
    if (this.state === "disconnected" || !this.ws) return;
    if (pcm24kHz.length === 0) return;
    this.send({
      type: "input_audio_buffer.append",
      audio: pcm24kHz.toString("base64"),
    });
  }

  /** Manually commit audio and trigger a response */
  commitAndRespond() {
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
  }

  /** Trigger response with custom instructions (for ambient mode) */
  triggerResponse(instructions?: string) {
    this.send({
      type: "response.create",
      response: instructions ? { instructions } : undefined,
    });
  }

  /** Cancel the current response (barge-in) */
  cancelResponse() {
    if (this.state !== "responding") return;
    this.send({ type: "response.cancel" });
  }

  /** Clear the audio input buffer */
  clearAudioBuffer() {
    this.send({ type: "input_audio_buffer.clear" });
  }

  /** Inject a conversation item (for context recovery or system messages) */
  injectItem(item: ConversationItem) {
    this.send({ type: "conversation.item.create", item });
  }

  /** Submit a function call result back to the model */
  submitFunctionResult(callId: string, output: string) {
    this.injectItem({
      type: "function_call_output",
      call_id: callId,
      output,
    });
    // Trigger the model to continue after receiving the tool result
    this.send({ type: "response.create" });
  }

  /** Update session configuration (e.g., change turn detection, tools) */
  updateSession(config: Partial<RealtimeSessionConfig>) {
    this.send({ type: "session.update", session: config });
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private configureSession() {
    const tools = toolRegistry.toRealtimeTools();
    realtimeLog.info({ toolCount: tools.length }, "configuring session");

    this.send({
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        voice: env.openai.realtimeVoice as "nova",
        instructions: this.opts.instructions,
        input_audio_format: "pcm16",
        output_audio_format: "pcm16",
        input_audio_transcription: { model: "whisper-1" },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 400,
          create_response: false, // Manual control for wake-word / ambient mode
        },
        tools,
        tool_choice: "auto",
        temperature: 0.8,
        max_response_output_tokens: 4096,
      },
    });
  }

  private handleEvent(event: ServerEvent) {
    switch (event.type) {
      case "session.created":
        realtimeLog.info("session created");
        break;

      case "session.updated":
        realtimeLog.info("session config updated");
        break;

      case "conversation.item.created":
        if (event.item?.id) this.itemIds.push(event.item.id);
        break;

      case "input_audio_buffer.speech_started":
        this.opts.onSpeechStarted();
        break;

      case "input_audio_buffer.speech_stopped":
        this.opts.onSpeechStopped();
        break;

      case "conversation.item.input_audio_transcription.completed":
        this.opts.onTranscript(event.transcript, event.item_id);
        break;

      case "response.audio.delta": {
        const audio = Buffer.from(event.delta, "base64");
        this.opts.onAudioDelta(audio);
        this.state = "responding";
        break;
      }

      case "response.audio.done":
        // Audio is fully delivered — no valid response to cancel from here.
        // Set state before calling onAudioDone so barge-in in the callback
        // doesn't race-send a cancel that will be rejected.
        this.state = "ready";
        this.opts.onAudioDone();
        break;

      case "response.audio_transcript.done":
        this.opts.onResponseTranscript(event.transcript);
        break;

      case "response.function_call_arguments.done":
        this.opts.onFunctionCall(event.name, event.arguments, event.call_id, event.item_id);
        break;

      case "response.done":
        this.state = "ready";
        if (event.response.usage) {
          realtimeLog.info(
            {
              tokens: event.response.usage.total_tokens,
              input: event.response.usage.input_tokens,
              output: event.response.usage.output_tokens,
            },
            "response usage"
          );
          if (event.response.usage.input_tokens > CONTEXT_PRUNE_THRESHOLD) {
            this.pruneContext();
          }
        }
        break;

      case "error":
        this.opts.onError(event.error);
        realtimeLog.error({ error: event.error }, "realtime API error");
        break;

      case "rate_limits.updated":
        for (const rl of event.rate_limits) {
          if (rl.remaining < rl.limit * 0.1) {
            realtimeLog.warn({ rateLimit: rl }, "approaching rate limit");
          }
        }
        break;

      default:
        // Many event types we don't need to handle explicitly
        break;
    }
  }

  private pruneContext() {
    // Delete the oldest N items to keep input tokens under control.
    // We keep the most recent items so Nova retains short-term context.
    const toDelete = this.itemIds.splice(0, CONTEXT_PRUNE_BATCH);
    for (const id of toDelete) {
      this.send({ type: "conversation.item.delete", item_id: id });
    }
    realtimeLog.info({ deleted: toDelete.length, remaining: this.itemIds.length }, "pruned conversation context");
  }

  private send(event: ClientEvent) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(event));
  }

  private startKeepAlive() {
    // WebSocket ping frames keep the connection alive without sending empty audio
    this.keepAliveTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
      }
    }, 15_000);
  }

  private stopKeepAlive() {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      realtimeLog.error(
        { attempts: this.reconnectAttempts },
        "max reconnect attempts reached — giving up"
      );
      this.emit("fatal-disconnect");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** (this.reconnectAttempts - 1), 30_000);
    const jitter = delay * (0.5 + Math.random() * 0.5);

    realtimeLog.info(
      { attempt: this.reconnectAttempts, delayMs: Math.round(jitter) },
      "scheduling reconnect"
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
        this.emit("reconnected");
      } catch (err) {
        realtimeLog.error({ error: String(err) }, "reconnect failed");
        this.attemptReconnect();
      }
    }, jitter);
  }
}
