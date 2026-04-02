/**
 * OpenClaw gateway configuration generator.
 *
 * If you want to run the agent through OpenClaw's gateway
 * (e.g., to also respond on Telegram/Slack alongside meetings),
 * this generates the openclaw.json configuration.
 *
 * For meeting-only use, the direct MeetingAgent class in agent.ts
 * is preferred — it gives tighter control over the real-time audio loop.
 */

import { env } from "../config/env.js";
import { SYSTEM_PROMPT } from "./prompt.js";

export function generateOpenClawConfig() {
  return {
    version: 1,
    llm: {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      apiKey: env.anthropic.apiKey,
    },
    system_prompt: SYSTEM_PROMPT,
    gateway: {
      port: env.openclaw.port,
    },
    messages: {
      stt: {
        provider: "openai",
        apiKey: env.openai.apiKey,
        model: "whisper-1",
      },
      tts: {
        provider: "elevenlabs",
        apiKey: env.elevenlabs.apiKey,
        voiceId: env.elevenlabs.voiceId,
        model: "eleven_turbo_v2_5",
        auto: "on_demand",
      },
    },
    skills: [
      {
        name: "search_knowledge_base",
        description:
          "Search the team's Obsidian knowledge base for relevant information.",
        type: "custom",
        handler: "./skills/knowledge-skill.js",
      },
    ],
  };
}
