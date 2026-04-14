import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { searchKnowledge } from "../knowledge/store.js";
import { searchEmail } from "./tools/email-search.js";
import { UpcomingMeeting } from "../calendar/monitor.js";

const anthropic = new Anthropic({ apiKey: env.anthropic.apiKey });

/**
 * Generate a spoken pre-meeting brief for Nova to deliver after joining.
 * Pulls context from: KB, past meeting notes, recent email with attendees.
 */
export async function generateMeetingBrief(
  meeting: UpcomingMeeting
): Promise<string> {
  const [kbResults, noteResults] = await Promise.all([
    searchKnowledge(meeting.summary, 3).catch(() => []),
    searchKnowledge(`meeting ${meeting.summary}`, 3).catch(() => []),
  ]);

  // Search for recent email with any attendee (first 3 to keep it fast)
  const emailSnippets: string[] = [];
  for (const email of meeting.participants.slice(0, 3)) {
    try {
      const results = await searchEmail(`from:${email} OR to:${email}`, 1);
      if (results[0]) emailSnippets.push(`${results[0].subject} (${results[0].from})`);
    } catch {
      // Non-fatal
    }
  }

  const kbContext = kbResults.length
    ? kbResults.map((r) => `• ${r.heading}: ${r.content.slice(0, 200)}`).join("\n")
    : "No relevant knowledge base entries.";

  const notesContext = noteResults.length
    ? noteResults.map((r) => `• ${r.heading}: ${r.content.slice(0, 200)}`).join("\n")
    : "No past meeting notes found.";

  const emailContext = emailSnippets.length
    ? emailSnippets.join("; ")
    : "No recent email threads found.";

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 250,
    messages: [
      {
        role: "user",
        content: `Write a brief spoken pre-meeting context summary (2–4 sentences max, conversational tone) for Nova to say when she joins the call.

Meeting: ${meeting.summary}
Attendees: ${meeting.participants.join(", ") || "not listed"}
Time: ${meeting.startTime.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}

Knowledge base context:
${kbContext}

Past meeting notes:
${notesContext}

Recent email threads with attendees:
${emailContext}

Start with "Quick context before we begin:" — keep it to 2–4 sentences, no filler. Only mention items that are genuinely relevant. If nothing useful was found, say so briefly.`,
      },
    ],
  });

  return (
    response.content.find((b): b is Anthropic.TextBlock => b.type === "text")
      ?.text ?? ""
  );
}

/**
 * Generate a catch-up summary for someone who joined the meeting late.
 * Called with the formatted rolling transcript and the late joiner's name.
 */
export async function generateLateJoinerBrief(
  transcriptText: string,
  joinerName: string
): Promise<string> {
  if (!transcriptText.trim() || transcriptText === "(No conversation yet)") {
    return "Nothing to catch up on yet — you're right on time.";
  }

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `${joinerName} just joined the meeting late. Write a 2–3 sentence catch-up summary (conversational, no bullet points) of what they missed, based on this transcript:

${transcriptText.slice(-3000)}

Start with "Here's what you missed:"`,
      },
    ],
  });

  return (
    response.content.find((b): b is Anthropic.TextBlock => b.type === "text")
      ?.text ?? ""
  );
}
