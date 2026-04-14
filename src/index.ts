import { env, requireGoogle } from "./config/env.js";
import { CalendarMonitor, UpcomingMeeting } from "./calendar/monitor.js";
import { PlaywrightMeetBot } from "./meet/playwright-bot.js";
import { VoiceActivityDetector } from "./audio/vad.js";
import { DeepgramTranscriber } from "./audio/deepgram-stt.js";
import { transcribeAudio } from "./audio/stt.js";
import { synthesizeSpeech } from "./audio/tts.js";
import { MeetingAgent } from "./agent/agent.js";
import { watchVault } from "./knowledge/watcher.js";
import { generateMeetingBrief, generateLateJoinerBrief } from "./agent/briefer.js";
import { checkForConflict } from "./agent/conflict-detector.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function speak(
  bot: PlaywrightMeetBot,
  text: string,
  channel: "voice" | "chat" = "voice"
) {
  if (!text.trim()) return;
  if (channel === "voice") {
    const audio = await synthesizeSpeech(text);
    bot.sendAudio(audio);
  } else {
    await bot.sendChat(text);
  }
}

// ── Meeting handler ───────────────────────────────────────────────────────────

async function handleMeeting(meeting: UpcomingMeeting) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Joining: ${meeting.summary}`);
  console.log(`Link:    ${meeting.meetLink}`);
  console.log(`${"=".repeat(60)}\n`);

  // ── 1. Generate pre-meeting brief (runs while bot is starting) ─────────────
  const briefPromise = generateMeetingBrief(meeting);

  // ── 2. Join the meeting ────────────────────────────────────────────────────
  const bot = new PlaywrightMeetBot();
  const agent = new MeetingAgent();

  try {
    await bot.join(meeting.meetLink);
  } catch (err) {
    console.error("[Main] Failed to join meeting:", err);
    return;
  }

  // ── 3. Speak brief 3 s after joining (give room time to settle) ────────────
  briefPromise
    .then(async (brief) => {
      if (!brief) return;
      await delay(3000);
      console.log(`[Brief] ${brief}`);
      await speak(bot, brief, "voice");
    })
    .catch((err) => console.error("[Brief] Error generating brief:", err));

  // ── 4. Audio pipeline — Deepgram (streaming+diarization) or Whisper fallback
  let utteranceCount = 0;

  const processVoice = async (speaker: string, text: string) => {
    if (!text.trim()) return;
    utteranceCount++;
    console.log(`[${speaker}] ${text}`);

    const response = await agent.processUtterance(speaker, text, "voice");
    if (response) {
      console.log(`[Nova] (${response.channel}) ${response.text}`);
      await speak(bot, response.text, response.channel);
    }

    // Conflict detector — fires every 5 utterances, never blocks the main loop
    if (utteranceCount % 5 === 0) {
      checkForConflict(text, agent.getTranscriptText())
        .then(async (conflict) => {
          if (conflict) {
            console.log(`[Conflict] ${conflict}`);
            await speak(bot, `Heads up — ${conflict}`, "voice");
          }
        })
        .catch((err) => console.error("[Conflict] Error:", err));
    }
  };

  // Whisper pipeline — used as fallback or primary when Deepgram is absent
  const startWhisperPipeline = () => {
    console.log("[Main] Starting Whisper audio pipeline.");
    const vad = new VoiceActivityDetector();
    bot.on("audio", (frame: Buffer) => vad.processFrame(frame));
    vad.on("segment", async (segment: Buffer) => {
      try {
        const text = await transcribeAudio(segment);
        await processVoice("Participant", text);
      } catch (err) {
        console.error("[Main] Whisper error:", err);
      }
    });
  };

  if (env.deepgram.apiKey) {
    // ── Deepgram streaming path ──────────────────────────────────────────────
    const transcriber = new DeepgramTranscriber();
    let deepgramActive = false;

    try {
      await transcriber.connect();
      deepgramActive = true;
    } catch (err) {
      console.error("[Main] Deepgram failed to connect — using Whisper:", err);
      startWhisperPipeline();
    }

    if (deepgramActive) {
      bot.on("audio", (frame: Buffer) => transcriber.sendAudio(frame));
      transcriber.on("utterance", ({ speaker, text }) =>
        processVoice(speaker, text).catch(console.error)
      );
      // If Deepgram drops mid-meeting, switch to Whisper automatically
      transcriber.on("closed", () => {
        console.warn("[Main] Deepgram connection closed — switching to Whisper.");
        startWhisperPipeline();
      });
      bot.on("disconnected", () => transcriber.disconnect());
    }
  } else {
    startWhisperPipeline();
  }

  // ── 5. Chat pipeline — auth-checked, code-aware ───────────────────────────
  bot.on("chat", async (sender: string, text: string) => {
    try {
      console.log(`[Chat] ${sender}: ${text}`);
      const response = await agent.processUtterance(sender, text, "chat");
      if (response) {
        // Force CHAT for code reviews (output can be very long)
        const hasCode = /```[\s\S]+```/.test(text);
        const channel = hasCode ? "chat" : response.channel;
        console.log(`[Nova] (${channel}) ${response.text}`);
        await speak(bot, response.text, channel);
      }
    } catch (err) {
      console.error("[Main] Chat pipeline error:", err);
    }
  });

  // ── 6. Late joiner brief ───────────────────────────────────────────────────
  // 2-minute grace period for initial attendees; brief anyone who joins after.
  const initialParticipants = new Set<string>();
  let gracePeriodOver = false;
  setTimeout(() => {
    gracePeriodOver = true;
    console.log("[Main] Grace period over — late joiner briefs active.");
  }, 120_000);

  bot.on("participant-joined", async (name: string) => {
    if (!gracePeriodOver) {
      initialParticipants.add(name);
      return;
    }
    console.log(`[LateJoiner] ${name} joined — generating catch-up.`);
    try {
      const catchup = await generateLateJoinerBrief(
        agent.getTranscriptText(),
        name
      );
      if (catchup) {
        await bot.sendChat(`@${name} — ${catchup}`);
      }
    } catch (err) {
      console.error("[LateJoiner] Error:", err);
    }
  });

  // ── 7. Disconnection ────────────────────────────────────────────────────────
  bot.on("disconnected", () => {
    console.log(`[Main] Disconnected from: ${meeting.summary}`);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  requireGoogle();

  console.log("Nova Meeting Agent starting...");
  console.log(`Email:    ${env.google.agentEmail}`);
  console.log(`Deepgram: ${env.deepgram.apiKey ? "enabled (streaming + diarization)" : "disabled (using Whisper fallback)"}`);
  console.log();

  watchVault(env.knowledge.vaultPath);

  const monitor = new CalendarMonitor({ lookaheadMinutes: 5, pollSeconds: 60 });

  monitor.on("meeting", (meeting: UpcomingMeeting) => {
    handleMeeting(meeting).catch((err) =>
      console.error("[Main] Unhandled error in meeting handler:", err)
    );
  });

  monitor.start();

  const shutdown = () => {
    console.log("\nShutting down...");
    monitor.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
