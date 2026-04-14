import { google, calendar_v3 } from "googleapis";
import { createOAuth2Client } from "../config/google-auth.js";
import { env } from "../config/env.js";
import { EventEmitter } from "events";

export interface UpcomingMeeting {
  eventId: string;
  summary: string;
  meetLink: string;
  startTime: Date;
  participants: string[];
}

/**
 * Polls Google Calendar for meetings the agent is invited to
 * that start within the lookahead window.
 */
export class CalendarMonitor extends EventEmitter {
  private calendar: calendar_v3.Calendar;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private seenEventIds = new Set<string>();
  private lookaheadMs: number;
  private pollMs: number;

  constructor(opts?: { lookaheadMinutes?: number; pollSeconds?: number }) {
    super();
    const auth = createOAuth2Client();
    this.calendar = google.calendar({ version: "v3", auth });
    this.lookaheadMs = (opts?.lookaheadMinutes ?? 5) * 60_000;
    this.pollMs = (opts?.pollSeconds ?? 60) * 1_000;
  }

  start() {
    console.log(
      `[CalendarMonitor] Polling every ${this.pollMs / 1000}s for meetings starting within ${this.lookaheadMs / 60_000} minutes`
    );
    this.poll();
    this.pollInterval = setInterval(() => this.poll(), this.pollMs);
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  private async poll() {
    try {
      const now = new Date();
      const soon = new Date(now.getTime() + this.lookaheadMs);

      const res = await this.calendar.events.list({
        calendarId: "primary",
        timeMin: now.toISOString(),
        timeMax: soon.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
      });

      const events = res.data.items ?? [];

      for (const event of events) {
        if (!event.id || this.seenEventIds.has(event.id)) continue;

        const meetLink = this.extractMeetLink(event);
        if (!meetLink) continue;

        // Skip events that started more than 2 minutes ago — avoids rejoining
        // a meeting that already ended after a process restart clears seenEventIds.
        const startTime = new Date(event.start?.dateTime ?? event.start?.date ?? now);
        if (now.getTime() - startTime.getTime() > 2 * 60_000) {
          console.log(`[CalendarMonitor] Skipping past event: "${event.summary ?? event.id}"`);
          this.seenEventIds.add(event.id); // mark seen so we don't log it every poll
          continue;
        }

        this.seenEventIds.add(event.id);

        const meeting: UpcomingMeeting = {
          eventId: event.id,
          summary: event.summary ?? "(untitled)",
          meetLink,
          startTime: new Date(
            event.start?.dateTime ?? event.start?.date ?? now
          ),
          participants:
            event.attendees?.map((a) => a.email ?? "unknown") ?? [],
        };

        console.log(
          `[CalendarMonitor] Detected meeting: "${meeting.summary}" at ${meeting.startTime.toLocaleTimeString()}`
        );
        this.emit("meeting", meeting);
      }
    } catch (err) {
      console.error("[CalendarMonitor] Poll error:", err);
    }
  }

  private extractMeetLink(
    event: calendar_v3.Schema$Event
  ): string | undefined {
    if (event.hangoutLink) return event.hangoutLink;
    const entry = event.conferenceData?.entryPoints?.find(
      (ep) => ep.entryPointType === "video"
    );
    return entry?.uri ?? undefined;
  }
}
