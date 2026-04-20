// ── OpenAI Realtime API event types ─────────────────────────────────────────
// Reference: https://platform.openai.com/docs/api-reference/realtime

export interface RealtimeSessionConfig {
  model: string;
  modalities: Array<"text" | "audio">;
  voice: string;
  instructions: string;
  input_audio_format: "pcm16" | "g711_ulaw" | "g711_alaw";
  output_audio_format: "pcm16" | "g711_ulaw" | "g711_alaw";
  input_audio_transcription: { model: string } | null;
  turn_detection: {
    type: "server_vad";
    threshold: number;
    prefix_padding_ms: number;
    silence_duration_ms: number;
    create_response: boolean;
  } | null;
  tools: Array<{
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
  tool_choice: "auto" | "none" | "required";
  temperature: number;
  max_response_output_tokens: number | "inf";
}

// ── Client → Server Events ──────────────────────────────────────────────────

export interface SessionUpdateEvent {
  type: "session.update";
  session: Partial<RealtimeSessionConfig>;
}

export interface InputAudioBufferAppendEvent {
  type: "input_audio_buffer.append";
  audio: string; // base64 encoded PCM16
}

export interface InputAudioBufferCommitEvent {
  type: "input_audio_buffer.commit";
}

export interface InputAudioBufferClearEvent {
  type: "input_audio_buffer.clear";
}

export interface ConversationItemCreateEvent {
  type: "conversation.item.create";
  item: ConversationItem;
}

export interface ResponseCreateEvent {
  type: "response.create";
  response?: {
    modalities?: Array<"text" | "audio">;
    instructions?: string;
  };
}

export interface ResponseCancelEvent {
  type: "response.cancel";
}

export interface ConversationItemDeleteEvent {
  type: "conversation.item.delete";
  item_id: string;
}

export type ClientEvent =
  | SessionUpdateEvent
  | InputAudioBufferAppendEvent
  | InputAudioBufferCommitEvent
  | InputAudioBufferClearEvent
  | ConversationItemCreateEvent
  | ConversationItemDeleteEvent
  | ResponseCreateEvent
  | ResponseCancelEvent;

// ── Server → Client Events ──────────────────────────────────────────────────

export interface SessionCreatedEvent {
  type: "session.created";
  session: RealtimeSessionConfig;
}

export interface SessionUpdatedEvent {
  type: "session.updated";
  session: RealtimeSessionConfig;
}

export interface InputAudioBufferSpeechStartedEvent {
  type: "input_audio_buffer.speech_started";
  audio_start_ms: number;
  item_id: string;
}

export interface InputAudioBufferSpeechStoppedEvent {
  type: "input_audio_buffer.speech_stopped";
  audio_end_ms: number;
  item_id: string;
}

export interface InputAudioBufferCommittedEvent {
  type: "input_audio_buffer.committed";
  previous_item_id: string | null;
  item_id: string;
}

export interface ConversationItemCreatedEvent {
  type: "conversation.item.created";
  previous_item_id: string | null;
  item: ConversationItem;
}

export interface ResponseCreatedEvent {
  type: "response.created";
  response: ResponseObject;
}

export interface ResponseDoneEvent {
  type: "response.done";
  response: ResponseObject;
}

export interface ResponseAudioDeltaEvent {
  type: "response.audio.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string; // base64 encoded PCM16
}

export interface ResponseAudioDoneEvent {
  type: "response.audio.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
}

export interface ResponseAudioTranscriptDeltaEvent {
  type: "response.audio_transcript.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseAudioTranscriptDoneEvent {
  type: "response.audio_transcript.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  transcript: string;
}

export interface ResponseTextDeltaEvent {
  type: "response.text.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;
}

export interface ResponseTextDoneEvent {
  type: "response.text.done";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  text: string;
}

export interface ResponseFunctionCallArgumentsDeltaEvent {
  type: "response.function_call_arguments.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  delta: string;
}

export interface ResponseFunctionCallArgumentsDoneEvent {
  type: "response.function_call_arguments.done";
  response_id: string;
  item_id: string;
  output_index: number;
  call_id: string;
  name: string;
  arguments: string; // JSON string
}

export interface ConversationItemInputAudioTranscriptionCompletedEvent {
  type: "conversation.item.input_audio_transcription.completed";
  item_id: string;
  content_index: number;
  transcript: string;
}

export interface ErrorEvent {
  type: "error";
  error: { type: string; code: string; message: string; param: string | null; event_id: string | null };
}

export interface RateLimitsUpdatedEvent {
  type: "rate_limits.updated";
  rate_limits: Array<{ name: string; limit: number; remaining: number; reset_seconds: number }>;
}

export type ServerEvent =
  | SessionCreatedEvent
  | SessionUpdatedEvent
  | InputAudioBufferSpeechStartedEvent
  | InputAudioBufferSpeechStoppedEvent
  | InputAudioBufferCommittedEvent
  | ConversationItemCreatedEvent
  | ResponseCreatedEvent
  | ResponseDoneEvent
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent
  | ResponseAudioTranscriptDeltaEvent
  | ResponseAudioTranscriptDoneEvent
  | ResponseTextDeltaEvent
  | ResponseTextDoneEvent
  | ResponseFunctionCallArgumentsDeltaEvent
  | ResponseFunctionCallArgumentsDoneEvent
  | ConversationItemInputAudioTranscriptionCompletedEvent
  | ErrorEvent
  | RateLimitsUpdatedEvent;

// ── Shared types ────────────────────────────────────────────────────────────

export interface ConversationItem {
  id?: string;
  type: "message" | "function_call" | "function_call_output";
  role?: "user" | "assistant" | "system";
  content?: Array<{
    type: "input_text" | "input_audio" | "text" | "audio";
    text?: string;
    audio?: string;
    transcript?: string;
  }>;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string;
  status?: "completed" | "in_progress" | "incomplete";
}

export interface ResponseObject {
  id: string;
  status: "completed" | "cancelled" | "failed" | "incomplete" | "in_progress";
  output: ConversationItem[];
  usage?: {
    total_tokens: number;
    input_tokens: number;
    output_tokens: number;
    input_token_details?: { cached_tokens: number; text_tokens: number; audio_tokens: number };
    output_token_details?: { text_tokens: number; audio_tokens: number };
  };
}
