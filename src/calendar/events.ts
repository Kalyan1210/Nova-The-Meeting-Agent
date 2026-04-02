import { google } from "googleapis";
import { createOAuth2Client } from "../config/google-auth.js";

const calendar = google.calendar({ version: "v3", auth: createOAuth2Client() });

export interface NewEvent {
  summary: string;
  description?: string;
  startTime: string;
  endTime: string;
  attendees?: string[];
}

/**
 * Create a new Google Calendar event.
 */
export async function createCalendarEvent(event: NewEvent): Promise<string> {
  const res = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startTime, timeZone: "America/New_York" },
      end: { dateTime: event.endTime, timeZone: "America/New_York" },
      attendees: event.attendees?.map((email) => ({ email })),
      conferenceData: {
        createRequest: { requestId: crypto.randomUUID() },
      },
    },
    conferenceDataVersion: 1,
  });

  return res.data.htmlLink ?? `Event created: ${res.data.id}`;
}
