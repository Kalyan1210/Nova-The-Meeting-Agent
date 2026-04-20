import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

// ── Schema ──────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // OpenAI (required)
  OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
  OPENAI_REALTIME_MODEL: z.string().default("gpt-4o-realtime-preview"),
  OPENAI_REALTIME_VOICE: z.string().default("alloy"),

  // Anthropic (optional — kept during migration, removed in Phase 3)
  ANTHROPIC_API_KEY: z.string().optional(),

  // Google
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),
  AGENT_EMAIL: z.string().optional(),

  // Deepgram (optional — for enhanced speaker diarization)
  DEEPGRAM_API_KEY: z.string().optional(),

  // ElevenLabs (legacy — unused in new pipeline)
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),
  ELEVENLABS_FALLBACK_VOICE_ID: z.string().default("21m00Tcm4TlvDq8ikWAM"),

  // Knowledge
  OBSIDIAN_VAULT_PATH: z.string().optional(),

  // Web search
  TAVILY_API_KEY: z.string().optional(),

  // Meeting
  MEET_HEADLESS: z.string().default("true"),
  AUTHORIZED_EMAILS: z.string().default(""),

  // Database
  DATABASE_PATH: z.string().optional(),

  // Logging
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),

  // Slack (optional)
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_DEFAULT_CHANNEL: z.string().optional(),

  // Notion (optional)
  NOTION_API_KEY: z.string().optional(),
  NOTION_DATABASE_ID: z.string().optional(),

  // Ambient mode
  AMBIENT_MODE_DEFAULT: z.string().default("false"),

  // Legacy
  OPENCLAW_PORT: z.string().default("18789"),
});

// ── Parse & Validate ────────────────────────────────────────────────────────

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Environment validation failed:");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const p = parsed.data;

// ── Exported config ─────────────────────────────────────────────────────────

export const env = {
  google: {
    clientId: p.GOOGLE_CLIENT_ID ?? "",
    clientSecret: p.GOOGLE_CLIENT_SECRET ?? "",
    refreshToken: p.GOOGLE_REFRESH_TOKEN ?? "",
    agentEmail: p.AGENT_EMAIL ?? "",
  },
  anthropic: {
    apiKey: p.ANTHROPIC_API_KEY ?? "",
  },
  openai: {
    apiKey: p.OPENAI_API_KEY,
    realtimeModel: p.OPENAI_REALTIME_MODEL,
    realtimeVoice: p.OPENAI_REALTIME_VOICE,
  },
  elevenlabs: {
    apiKey: p.ELEVENLABS_API_KEY ?? "",
    voiceId: p.ELEVENLABS_VOICE_ID,
    fallbackVoiceId: p.ELEVENLABS_FALLBACK_VOICE_ID,
  },
  meet: {
    headless: p.MEET_HEADLESS !== "false",
  },
  knowledge: {
    vaultPath: p.OBSIDIAN_VAULT_PATH ?? "",
  },
  tavily: {
    apiKey: p.TAVILY_API_KEY ?? "",
  },
  deepgram: {
    apiKey: p.DEEPGRAM_API_KEY ?? "",
  },
  agent: {
    authorizedEmails: p.AUTHORIZED_EMAILS
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean),
    ambientModeDefault: p.AMBIENT_MODE_DEFAULT === "true",
  },
  database: {
    path: p.DATABASE_PATH,
  },
  slack: {
    botToken: p.SLACK_BOT_TOKEN ?? "",
    defaultChannel: p.SLACK_DEFAULT_CHANNEL ?? "",
  },
  notion: {
    apiKey: p.NOTION_API_KEY ?? "",
    databaseId: p.NOTION_DATABASE_ID ?? "",
  },
  openclaw: {
    port: parseInt(p.OPENCLAW_PORT, 10),
  },
  logging: {
    level: p.LOG_LEVEL,
    nodeEnv: p.NODE_ENV,
  },
} as const;

/**
 * Verify that Google credentials are configured.
 * Call this at the entry points that need Google (main agent, calendar monitor)
 * rather than at import time so test-agent can run without them.
 */
export function requireGoogle() {
  const missing = [];
  if (!env.google.clientId) missing.push("GOOGLE_CLIENT_ID");
  if (!env.google.clientSecret) missing.push("GOOGLE_CLIENT_SECRET");
  if (!env.google.refreshToken) missing.push("GOOGLE_REFRESH_TOKEN");
  if (!env.google.agentEmail) missing.push("AGENT_EMAIL");
  if (missing.length > 0) {
    throw new Error(
      `Missing required Google credentials: ${missing.join(", ")}. ` +
        "Run 'npm run oauth-setup' to configure."
    );
  }
}
