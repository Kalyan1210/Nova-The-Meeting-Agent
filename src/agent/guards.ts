import { env } from "../config/env.js";

/**
 * Wake word patterns Nova responds to.
 * Both voice transcripts and chat messages must match one of these.
 */
const WAKE_PATTERNS = [
  /hey\s+nova/i,        // "hey nova" — no \b so works in concatenated chat text
  /hey\s+noah/i,        // Deepgram/Whisper often mishears "Nova" as "Noah"
  /\bnova[,!?:]\s/i,    // "nova, ..." / "nova! ..."
  /^nova[\s,]/i,        // "nova what is ..."
];

/**
 * Returns true if the text is addressed to Nova.
 */
export function hasWakeWord(text: string): boolean {
  return WAKE_PATTERNS.some((p) => p.test(text.trim()));
}

/**
 * Returns true if the speaker is on the authorized list.
 *
 * For voice utterances the speaker is "Participant" (unknown email) — pass
 * source="voice" to skip the email check and rely on wake word alone.
 *
 * For chat messages the sender email is known — pass source="chat" to
 * enforce the email whitelist.
 *
 * If AUTHORIZED_EMAILS is empty, all speakers are considered authorized.
 */
export function isAuthorized(
  speakerEmail: string,
  source: "voice" | "chat"
): boolean {
  // Voice: anyone in the meeting can invoke Nova via wake word.
  if (source === "voice") return true;

  const list = env.agent.authorizedEmails;
  if (list.length === 0) return true; // no restriction configured

  // If we couldn't identify the sender (Meet DOM didn't expose email),
  // allow it — they were invited to the meeting, so they're trusted.
  if (!speakerEmail || speakerEmail === "unknown") return true;

  return list.some(
    (e) => e.toLowerCase() === speakerEmail.toLowerCase()
  );
}
