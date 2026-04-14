import { env, requireGoogle } from "./config/env.js";
import { CalendarMonitor, UpcomingMeeting } from "./calendar/monitor.js";
import { PlaywrightMeetBot } from "./meet/playwright-bot.js";
import { VoiceActivityDetector } from "./audio/vad.js";
import { transcribeAudio } from "./audio/stt.js";
import { synthesizeSpeech } from "./audio/tts.js";
import { MeetingAgent } from "./agent/agent.js";
import { watchVault } from "./knowledge/watcher.js";

async function handleMeeting(meeting: UpcomingMeeting) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Joining meeting: ${meeting.summary}`);
  console.log(`Meet link: ${meeting.meetLink}`);
  console.log(`${"=".repeat(60)}\n`);

  const bot = new PlaywrightMeetBot();
  const agent = new MeetingAgent();
  const vad = new VoiceActivityDetector();

  try {
    await bot.join(meeting.meetLink);
  } catch (err) {
    console.error("[Main] Failed to join meeting:", err);
    return;
  }

  // ── Voice pipeline: audio frame → VAD → Whisper → agent → TTS/chat ─────────
  bot.on("audio", (frame: Buffer) => {
    vad.processFrame(frame);
  });

  vad.on("segment", async (segment: Buffer) => {
    try {
      const text = await transcribeAudio(segment);
      if (!text.trim()) return;

      console.log(`[Transcript] ${text}`);
      const response = await agent.processUtterance("Participant", text, "voice");

      if (response) {
        console.log(`[Nova] (${response.channel}) ${response.text}`);
        if (response.channel === "voice") {
          const audio = await synthesizeSpeech(response.text);
          bot.sendAudio(audio);
        } else {
          await bot.sendChat(response.text);
        }
      }
    } catch (err) {
      console.error("[Main] Error processing audio segment:", err);
    }
  });

  // ── Chat pipeline: typed message → auth guard → agent → TTS/chat ────────────
  bot.on("chat", async (sender: string, text: string) => {
    try {
      console.log(`[Chat] ${sender}: ${text}`);
      const response = await agent.processUtterance(sender, text, "chat");

      if (response) {
        console.log(`[Nova] (${response.channel}) ${response.text}`);
        if (response.channel === "voice") {
          const audio = await synthesizeSpeech(response.text);
          bot.sendAudio(audio);
        } else {
          await bot.sendChat(response.text);
        }
      }
    } catch (err) {
      console.error("[Main] Error processing chat message:", err);
    }
  });

  bot.on("disconnected", () => {
    console.log(`[Main] Disconnected from meeting: ${meeting.summary}`);
  });
}

async function main() {
  requireGoogle();

  console.log("Nova Meeting Agent starting...");
  console.log(`Agent email: ${env.google.agentEmail}`);
  console.log();

  watchVault(env.knowledge.vaultPath);

  const monitor = new CalendarMonitor({
    lookaheadMinutes: 5,
    pollSeconds: 60,
  });

  monitor.on("meeting", (meeting: UpcomingMeeting) => {
    handleMeeting(meeting).catch((err) => {
      console.error("[Main] Unhandled error in meeting handler:", err);
    });
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
