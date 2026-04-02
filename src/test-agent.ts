/**
 * Interactive text-mode test harness for the MeetingAgent.
 * Tests the Claude + knowledge base pipeline without needing
 * a live meeting or audio hardware.
 *
 * Usage: npm run test-agent
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

import * as readline from "readline";
import { MeetingAgent } from "./agent/agent.js";

async function main() {
  const agent = new MeetingAgent();

  console.log("Nova Meeting Agent — Text Test Mode");
  console.log("Type a question as if you were in a meeting.");
  console.log('Type "quit" to exit.\n');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = () => {
    rl.question("You: ", async (input) => {
      const text = input.trim();
      if (!text || text.toLowerCase() === "quit") {
        rl.close();
        return;
      }

      const response = await agent.processUtterance("User", text);
      if (response) {
        const prefix = response.channel === "chat" ? "[CHAT]" : "[VOICE]";
        console.log(`\nAgent ${prefix}: ${response.text}\n`);
      } else {
        console.log("\n(Agent chose not to respond — not a question)\n");
      }

      prompt();
    });
  };

  prompt();
}

main().catch(console.error);
