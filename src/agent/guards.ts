import { env } from "../config/env.js";

/**
 * Wake word patterns Nova responds to.
 * Both voice transcripts and chat messages must match one of these.
 */
const WAKE_PATTERNS = [
  /hey\s+nova/i,        // "hey nova"
  /hey\s+noah/i,        // Whisper mishears "Nova" as "Noah"
  /hey\s+enoa/i,        // Whisper mishears "Nova" as "Enoa"
  /hey\s+nova/i,        // alternate spelling seen in transcripts
  /\bnova[,!?:]\s/i,    // "nova, ..." / "nova! ..."
  /^nova[\s,]/i,        // "nova what is ..."
];

/**
 * Returns true if the text is addressed to Nova.
 *
 * Deepgram smart_format adds punctuation, so "Hey Nova" arrives as
 * "Hey, Nova." — we strip punctuation before matching so patterns
 * like /hey\s+nova/ still work.
 */
export function hasWakeWord(text: string): boolean {
  // Normalize for matching only: strip punctuation, collapse spaces
  const normalized = text
    .trim()
    .replace(/[,\.!?;:]/g, " ")
    .replace(/\s+/g, " ");
  return WAKE_PATTERNS.some((p) => p.test(normalized));
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

  // Meet sometimes exposes a display name ("YALLA SAI KALYAN") instead of
  // an email.  A display name can't be matched against the email whitelist,
  // so treat it the same as "unknown" — trusted by virtue of being invited.
  if (!speakerEmail.includes("@")) return true;

  return list.some(
    (e) => e.toLowerCase() === speakerEmail.toLowerCase()
  );
}
