import { env, requireGoogle } from "./config/env.js";
import { logger } from "./infra/logger.js";
import { installShutdownHandlers, onShutdown } from "./infra/shutdown.js";
import { CalendarMonitor, UpcomingMeeting } from "./calendar/monitor.js";
import { PlaywrightMeetBot } from "./meet/playwright-bot.js";
import { Resampler } from "./audio/resampler.js";
import { RealtimeSession } from "./realtime/session.js";
import { buildRealtimeInstructions } from "./agent/prompt.js";
import { watchVault } from "./knowledge/watcher.js";
import { registerAllTools } from "./tools/register-all.js";
import { executeTool } from "./tools/executor.js";
import { MeetingStore } from "./context/meeting-store.js";
import { ConversationState } from "./context/conversation-state.js";
import { AmbientListener } from "./context/ambient-listener.js";
import { SpeakerTracker } from "./context/speaker-tracker.js";
import { setScreenshotProvider } from "./tools/meeting-control/screen-analysis.js";
import { setParticipantsProvider } from "./tools/meeting-control/participants.js";
import { setMeetingState, appendToNotes } from "./tools/meeting-control/recording.js";
import { generateMeetingBrief, generateLateJoinerBrief } from "./agent/briefer.js";

// ── Globals ─────────────────────────────────────────────────────────────────

const store = new MeetingStore();

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Meeting handler ─────────────────────────────────────────────────────────

async function handleMeeting(meeting: UpcomingMeeting) {
  const log = logger.child({ meeting: meeting.summary });
  log.info({ link: meeting.meetLink }, "joining meeting");

  // Persist meeting to SQLite
  const meetingId = store.createMeeting({
    title: meeting.summary,
    start_time: new Date(meeting.startTime).toISOString(),
    end_time: null,
    participants: JSON.stringify(meeting.participants),
    meet_link: meeting.meetLink,
  });

  // ── 1. Start pre-meeting brief (runs while bot connects) ──────────────
  const briefPromise = generateMeetingBrief(meeting);

  // ── 2. Join the meeting ───────────────────────────────────────────────
  const bot = new PlaywrightMeetBot();
  const participants: string[] = [];

  try {
    await bot.join(meeting.meetLink);
  } catch (err) {
    log.error({ error: String(err) }, "failed to join meeting");
    return;
  }

  // Wire up meeting-control tools
  setScreenshotProvider(async () => {
    const page = (bot as unknown as { page: { screenshot: (opts: { type: string }) => Promise<Buffer> } }).page;
    return page.screenshot({ type: "png" });
  });
  setParticipantsProvider(() => [...participants]);
  setMeetingState({
    title: meeting.summary,
    startTime: new Date(),
    participants: meeting.participants,
  });

  // Track participants
  bot.on("participant-joined", (name: string) => {
    if (!participants.includes(name)) participants.push(name);
  });

  // ── 3. Set up conversation intelligence ────────────────────────────────
  const convState = new ConversationState({
    title: meeting.summary,
    startTime: new Date(),
    participants: meeting.participants,
    meetLink: meeting.meetLink,
  });
  const ambientListener = new AmbientListener(convState, env.agent.ambientModeDefault);
  const speakerTracker = new SpeakerTracker();
  meeting.participants.forEach((p) => speakerTracker.addParticipant(p));

  // ── 4. Set up OpenAI Realtime API session ─────────────────────────────
  const resampler = new Resampler(16000, 24000);

  const session = new RealtimeSession({
    instructions: buildRealtimeInstructions(),

    onAudioDelta: (audio: Buffer) => {
      // PCM16 24kHz from Realtime API → inject into browser
      bot.sendAudioStream(
        (async function* () {
          yield audio;
        })()
      ).catch(() => {}); // fire and forget individual chunks
    },

    onAudioDone: () => {
      log.info("Nova finished speaking");
    },

    onTranscript: (text: string, _itemId: string) => {
      // User's transcribed speech
      if (!text.trim()) return;
      const speaker = speakerTracker.resolve("Participant");
      log.info({ speaker, transcript: text }, "user speech");

      convState.addUtterance(speaker, text, "voice");
      appendToNotes(speaker, text);
      speakerTracker.addVoiceUtterance(speaker);

      store.addTranscript({
        meeting_id: meetingId,
        speaker,
        text,
        timestamp: new Date().toISOString(),
      });

      // Use AmbientListener to decide whether to respond
      const decision = ambientListener.evaluate(text, speaker);

      if (decision === "respond") {
        session.triggerResponse();
      } else if (decision === "mode-change") {
        // Mode changed — respond to confirm the change
        const mode = ambientListener.getMode();
        const confirmMsg = mode === "ambient"
          ? "Got it, I'll stay in the loop and chime in when I have something useful to add."
          : "Understood, I'll only respond when you say Hey Nova.";
        session.injectItem({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: `Respond with exactly: "${confirmMsg}"` }],
        });
        session.triggerResponse();
      }
    },

    onResponseTranscript: (text: string) => {
      // Nova's response transcript
      log.info({ response: text }, "Nova response");
      convState.addUtterance("Nova", text, "voice");
      appendToNotes("Nova", text);

      store.addTranscript({
        meeting_id: meetingId,
        speaker: "Nova",
        text,
        timestamp: new Date().toISOString(),
      });

      // If Nova's response ends with a question, enable conversation mode
      if (/\?/.test(text)) {
        ambientListener.enterConversationMode(30_000);
      }
    },

    onFunctionCall: async (name: string, argsJson: string, callId: string, _itemId: string) => {
      log.info({ tool: name }, "tool call");
      try {
        let args = JSON.parse(argsJson) as Record<string, unknown>;
        // Inject transcript for tools that need it
        if (["generate_meeting_summary", "extract_action_items", "draft_follow_up_email", "generate_meeting_minutes"].includes(name)) {
          args = { ...args, transcript: convState.getFullTranscript(), meeting_id: meetingId };
        }
        const result = await executeTool(name, args);
        session.submitFunctionResult(callId, result);
      } catch (err) {
        session.submitFunctionResult(callId, `Error: ${String(err)}`);
      }
    },

    onSpeechStarted: () => {
      // Barge-in: user started speaking while Nova is outputting
      bot.cancelAudio();
      session.cancelResponse();
      log.info("barge-in detected — cancelled response");
    },

    onSpeechStopped: () => {
      // Server VAD detected end of speech
    },

    onError: (error) => {
      log.error({ error }, "realtime API error");
    },
  });

  try {
    // Wait for WebRTC audio to settle, then connect Realtime API
    log.info("waiting for WebRTC audio to settle...");
    await delay(3000);
    await session.connect();
    log.info("Realtime API connected");
  } catch (err) {
    log.error({ error: String(err) }, "failed to connect Realtime API");
    return;
  }

  // ── 5. Audio pipeline: Browser → Resampler → Realtime API ────────────
  bot.on("audio", (frame: Buffer) => {
    const resampled = resampler.resample(frame);
    session.sendAudio(resampled);
  });

  // ── 6. Pre-meeting brief (speak via Realtime API) ─────────────────────
  briefPromise
    .then(async (brief) => {
      if (!brief) return;
      await delay(2000);
      log.info({ brief }, "delivering pre-meeting brief");
      // Inject the brief as a system message and trigger voice response
      session.injectItem({
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Meeting started: "${meeting.summary}". Deliver this brief to the meeting participants in a natural, conversational way: ${brief}`,
          },
        ],
      });
      session.triggerResponse();
    })
    .catch((err) => log.error({ error: String(err) }, "brief generation error"));

  // ── 7. Chat pipeline ─────────────────────────────────────────────────
  bot.on("chat", async (sender: string, text: string) => {
    log.info({ sender, text }, "chat message");
    convState.addUtterance(sender, text, "chat");
    speakerTracker.addChatSender(sender);

    // Inject chat as a user message and trigger response
    session.injectItem({
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: `[Chat message from ${sender}]: ${text}`,
        },
      ],
    });
    session.triggerResponse();
  });

  // ── 8. Late joiner briefs ────────────────────────────────────────────
  const initialParticipants = new Set<string>();
  let gracePeriodOver = false;
  setTimeout(() => {
    gracePeriodOver = true;
    log.info("grace period over — late joiner briefs active");
  }, 120_000);

  bot.on("participant-joined", async (name: string) => {
    if (!gracePeriodOver) {
      initialParticipants.add(name);
      return;
    }
    log.info({ joiner: name }, "late joiner detected");
    try {
      const catchup = await generateLateJoinerBrief(convState.getFullTranscript(), name);
      if (catchup) await bot.sendChat(`@${name} — ${catchup}`);
    } catch (err) {
      log.error({ error: String(err) }, "late joiner brief error");
    }
  });

  // ── 9. Participant tracking with speaker tracker ────────────────────
  bot.on("participant-joined", (name: string) => {
    speakerTracker.addParticipant(name);
  });

  // ── 10. Disconnection ────────────────────────────────────────────────
  bot.on("disconnected", async () => {
    log.info("disconnected from meeting");
    store.endMeeting(meetingId);
    session.disconnect();
    resampler.reset();
  });

  session.on("fatal-disconnect", () => {
    log.error("realtime API fatally disconnected — ending meeting");
    bot.disconnect?.();
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  installShutdownHandlers();
  requireGoogle();

  logger.info({
    email: env.google.agentEmail,
    realtimeModel: env.openai.realtimeModel,
    realtimeVoice: env.openai.realtimeVoice,
    deepgram: env.deepgram.apiKey ? "available (diarization)" : "disabled",
  }, "Nova Meeting Agent starting");

  // Register all tools
  registerAllTools();

  // Watch vault for changes
  watchVault(env.knowledge.vaultPath);

  // Register shutdown cleanup
  onShutdown("meeting-store", () => store.close());

  // Start calendar monitor
  const monitor = new CalendarMonitor({ lookaheadMinutes: 5, pollSeconds: 60 });
  onShutdown("calendar-monitor", () => monitor.stop());

  monitor.on("meeting", (meeting: UpcomingMeeting) => {
    handleMeeting(meeting).catch((err) =>
      logger.error({ error: String(err) }, "unhandled error in meeting handler")
    );
  });

  monitor.start();
  logger.info("calendar monitor started — waiting for meetings");
}

main().catch((err) => {
  logger.fatal({ error: String(err) }, "fatal error");
  process.exit(1);
});
