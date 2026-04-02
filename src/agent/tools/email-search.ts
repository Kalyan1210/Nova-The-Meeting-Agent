import { google } from "googleapis";
import { createOAuth2Client } from "../../config/google-auth.js";

/**
 * Search Gmail for messages matching a query.
 * Uses the same query syntax as the Gmail search bar.
 */
export async function searchEmail(
  query: string,
  maxResults = 5
): Promise<Array<{ subject: string; from: string; date: string; snippet: string }>> {
  const gmail = google.gmail({ version: "v1", auth: createOAuth2Client() });

  const list = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });

  const messages = list.data.messages ?? [];
  const results: Array<{ subject: string; from: string; date: string; snippet: string }> = [];

  for (const msg of messages) {
    const full = await gmail.users.messages.get({
      userId: "me",
      id: msg.id!,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });

    const headers = full.data.payload?.headers ?? [];
    const get = (name: string) =>
      headers.find((h) => h.name === name)?.value ?? "";

    results.push({
      subject: get("Subject"),
      from: get("From"),
      date: get("Date"),
      snippet: full.data.snippet ?? "",
    });
  }

  return results;
}
