import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { searchKnowledge } from "../knowledge/store.js";

const anthropic = new Anthropic({ apiKey: env.anthropic.apiKey });

// Patterns that indicate a decision or claim worth checking
const DECISION_PATTERN =
  /\b(we (will|should|are going to|decided|agreed|need to)|let'?s (go with|use|do|pick)|i think we|the plan is|going with|we'?ll (use|do|go|build)|decided to)\b/i;

/**
 * Checks if a statement conflicts with the recent meeting transcript or knowledge base.
 * Uses Haiku for speed — designed to run fire-and-forget in the background.
 *
 * Returns a short conflict description, or null if no conflict detected.
 * Only fires on decision-shaped statements (8+ words, matches DECISION_PATTERN).
 */
export async function checkForConflict(
  statement: string,
  recentTranscript: string
): Promise<string | null> {
  const words = statement.trim().split(/\s+/);
  if (words.length < 8) return null;
  if (!DECISION_PATTERN.test(statement)) return null;

  // Get KB context relevant to the statement
  const kbResults = await searchKnowledge(statement, 2).catch(() => []);
  const kbContext = kbResults.length
    ? kbResults.map((r) => `${r.heading}: ${r.content.slice(0, 300)}`).join("\n")
    : "";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    messages: [
      {
        role: "user",
        content: `You are silently monitoring a meeting for contradictions. Only flag CLEAR, direct conflicts — not minor differences of opinion.

New statement: "${statement}"

Recent transcript (last 2 min):
${recentTranscript.slice(-2000)}

${kbContext ? `Knowledge base context:\n${kbContext}` : ""}

Does this statement CLEARLY contradict a prior decision or established fact?
Reply with ONLY:
- The word NO if there is no clear conflict
- One short sentence describing the conflict (e.g. "This contradicts the earlier decision to use PostgreSQL instead of MySQL")`,
      },
    ],
  });

  const result =
    response.content
      .find((b): b is Anthropic.TextBlock => b.type === "text")
      ?.text?.trim() ?? "NO";

  if (result.toUpperCase().startsWith("NO")) return null;
  return result;
}
