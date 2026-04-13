import { google } from "googleapis";
import { createOAuth2Client } from "../config/google-auth.js";

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees: string[];
  meetLink?: string;
  description?: string;
}

/**
 * List upcoming Google Calendar events within a time window.
 * Defaults to the next 24 hours if no window is specified.
 */
export async function listCalendarEvents(opts?: {
  hoursAhead?: number;
  maxResults?: number;
}): Promise<CalendarEvent[]> {
  const calendar = google.calendar({ version: "v3", auth: createOAuth2Client() });

  const now = new Date();
  const until = new Date(now.getTime() + (opts?.hoursAhead ?? 24) * 60 * 60_000);

  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: now.toISOString(),
    timeMax: until.toISOString(),
    maxResults: opts?.maxResults ?? 10,
    singleEvents: true,
    orderBy: "startTime",
  });

  return (res.data.items ?? []).map((e) => ({
    id: e.id ?? "",
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? "",
    end: e.end?.dateTime ?? e.end?.date ?? "",
    attendees: (e.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    meetLink:
      e.hangoutLink ??
      e.conferenceData?.entryPoints?.find((ep) => ep.entryPointType === "video")
        ?.uri ??
      undefined,
    description: e.description ?? undefined,
  }));
}
