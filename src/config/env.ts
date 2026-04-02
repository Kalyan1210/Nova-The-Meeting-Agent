import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../../.env") });

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(key: string, fallback = ""): string {
  return process.env[key] || fallback;
}

export const env = {
  google: {
    clientId: optional("GOOGLE_CLIENT_ID"),
    clientSecret: optional("GOOGLE_CLIENT_SECRET"),
    refreshToken: optional("GOOGLE_REFRESH_TOKEN"),
    agentEmail: optional("AGENT_EMAIL"),
  },
  anthropic: {
    apiKey: required("ANTHROPIC_API_KEY"),
  },
  openai: {
    apiKey: required("OPENAI_API_KEY"),
  },
  elevenlabs: {
    apiKey: optional("ELEVENLABS_API_KEY"),
    voiceId: optional("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
  },
  knowledge: {
    vaultPath: optional("OBSIDIAN_VAULT_PATH"),
  },
  openclaw: {
    port: parseInt(optional("OPENCLAW_PORT", "18789"), 10),
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
