import Anthropic from "@anthropic-ai/sdk";
import { EventEmitter } from "events";
import { env } from "../config/env.js";
import { buildSystemPrompt } from "./prompt.js";
import { TranscriptBuffer } from "./transcript.js";
import { hasWakeWord, isAuthorized } from "./guards.js";
import { searchKnowledge } from "../knowledge/store.js";
import { createCalendarEvent } from "../calendar/events.js";
import { listCalendarEvents } from "../calendar/query.js";
import { searchEmail } from "./tools/email-search.js";
import { sendEmail } from "./tools/email-send.js";
import { searchWeb } from "./tools/web-search.js";
import { writeNote } from "../knowledge/writer.js";
import { readNote, listNotes } from "../knowledge/reader.js";

const anthropic = new Anthropic({ apiKey: env.anthropic.apiKey });

const TOOLS: Anthropic.Tool[] = [
  {
    name: "search_knowledge_base",
    description:
      "Search the team's Obsidian knowledge base for information relevant to a question. " +
      "Returns the most relevant document chunks with source citations.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query to find relevant knowledge.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "create_calendar_event",
    description:
      "Create a new Google Calendar event. Use when someone asks to schedule a meeting, " +
      "set a reminder, or add something to the calendar.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "Title of the event.",
        },
        start_time: {
          type: "string",
          description:
            "Start time in ISO 8601 format (e.g. 2026-04-02T10:00:00-04:00). " +
            "Infer the date from conversation context. Use America/New_York timezone.",
        },
        end_time: {
          type: "string",
          description:
            "End time in ISO 8601 format. If not specified, default to 30 minutes after start.",
        },
        description: {
          type: "string",
          description: "Optional event description or agenda.",
        },
        attendees: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of attendee email addresses.",
        },
      },
      required: ["summary", "start_time", "end_time"],
    },
  },
  {
    name: "search_email",
    description:
      "Search Gmail for emails matching a query. Use when someone asks about emails, " +
      "messages, or correspondence related to a topic or person.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description:
            "Gmail search query. Supports operators like from:, to:, subject:, has:attachment, " +
            "newer_than:, older_than:, etc.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default 5).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "write_note",
    description:
      "Write or append content to a markdown note in the Obsidian vault. " +
      "Use when someone asks to take notes, record a decision, or save information.",
    input_schema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description:
            "Name of the note file (e.g. 'meeting-notes-2026-04-02' or 'project-decisions'). " +
            "Do not include the .md extension.",
        },
        content: {
          type: "string",
          description:
            "Markdown content to write. Use headings, bullet points, etc. as appropriate.",
        },
        append: {
          type: "boolean",
          description:
            "If true (default), append to existing file. If false, overwrite.",
        },
      },
      required: ["filename", "content"],
    },
  },
  {
    name: "send_email",
    description:
      "Send an email via Gmail. Use when someone asks to email someone, send a follow-up, " +
      "share information, or notify a person or team.",
    input_schema: {
      type: "object" as const,
      properties: {
        to: {
          type: "array",
          items: { type: "string" },
          description: "List of recipient email addresses.",
        },
        subject: {
          type: "string",
          description: "Email subject line.",
        },
        body: {
          type: "string",
          description: "Plain text body of the email.",
        },
        cc: {
          type: "array",
          items: { type: "string" },
          description: "Optional list of CC recipient email addresses.",
        },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "search_web",
    description:
      "Search the web for current information, facts, or context not available in the " +
      "knowledge base. Use for recent news, external documentation, company info, or " +
      "any question that requires up-to-date public information.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Search query. Be specific for best results.",
        },
        max_results: {
          type: "number",
          description: "Number of results to return (default 3, max 5).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "list_calendar_events",
    description:
      "List upcoming Google Calendar events. Use when someone asks what meetings are scheduled, " +
      "what's on the calendar today, or wants to check availability.",
    input_schema: {
      type: "object" as const,
      properties: {
        hours_ahead: {
          type: "number",
          description:
            "How many hours ahead to look (default 24). Use 168 for the next week.",
        },
        max_results: {
          type: "number",
          description: "Maximum events to return (default 10).",
        },
      },
      required: [],
    },
  },
  {
    name: "read_note",
    description:
      "Read the contents of a specific note from the Obsidian vault. Use when someone " +
      "asks to retrieve, review, or read back a note. To find available notes, " +
      "omit the filename and set list_notes to true.",
    input_schema: {
      type: "object" as const,
      properties: {
        filename: {
          type: "string",
          description:
            "Name of the note to read (without .md extension). " +
            "Leave empty and set list_notes to true to list all available notes.",
        },
        list_notes: {
          type: "boolean",
          description: "If true, return a list of all available note names instead of reading one.",
        },
      },
      required: [],
    },
  },
];

export interface AgentResponse {
  text: string;
  channel: "voice" | "chat";
}

/**
 * Nova — core agent that processes meeting conversation and generates responses.
 * Uses Claude with tool use to query knowledge, create events, search email, and take notes.
 */
export class MeetingAgent extends EventEmitter {
  private transcript = new TranscriptBuffer();
  private model = "claude-sonnet-4-20250514";

  /**
   * Process an utterance from the meeting.
   *
   * @param speaker  Name or email of the speaker.
   * @param text     Transcribed or typed text.
   * @param source   "voice" (transcribed audio) or "chat" (typed message).
   *                 Chat messages enforce the AUTHORIZED_EMAILS whitelist;
   *                 voice messages only require the wake word.
   */
  async processUtterance(
    speaker: string,
    text: string,
    source: "voice" | "chat" = "voice"
  ): Promise<AgentResponse | null> {
    this.transcript.add(speaker, text);

    if (!this.shouldRespond(speaker, text, source)) return null;

    // Strip the wake word before passing to Claude so it doesn't
    // repeat "hey nova" back at the user.
    const cleaned = text.replace(/^(hey\s+nova[,!?:]?\s*|nova[,!?:]?\s+)/i, "").trim();
    const response = await this.generateResponse(cleaned || text);

    // Emit so external listeners (conflict detector, etc.) can react
    this.emit("utterance-processed", text);

    return response;
  }

  /** Expose the rolling transcript for external use (conflict detector, late joiner brief). */
  getTranscriptText(): string {
    return this.transcript.format();
  }

  private shouldRespond(
    speaker: string,
    text: string,
    source: "voice" | "chat"
  ): boolean {
    if (!hasWakeWord(text)) return false;
    if (!isAuthorized(speaker, source)) return false;
    return true;
  }

  private async generateResponse(
    currentQuestion: string
  ): Promise<AgentResponse> {
    const conversationContext = this.transcript.format();

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `## Recent Conversation Transcript\n${conversationContext}\n\n## Current Question\n${currentQuestion}`,
      },
    ];

    let response = await anthropic.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: buildSystemPrompt(),
      tools: TOOLS,
      messages,
    });

    while (response.stop_reason === "tool_use") {
      const toolBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of toolBlocks) {
        const result = await this.executeTool(block);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });

      response = await anthropic.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: buildSystemPrompt(),
        tools: TOOLS,
        messages,
      });
    }

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const responseText = textBlock?.text ?? "I'm not sure how to answer that.";

    const channel: "voice" | "chat" = responseText.startsWith("[CHAT]")
      ? "chat"
      : "voice";
    const cleanText = responseText.replace(/^\[CHAT\]\s*/, "");

    return { text: cleanText, channel };
  }

  private async executeTool(block: Anthropic.ToolUseBlock): Promise<string> {
    try {
      switch (block.name) {
        case "search_knowledge_base": {
          const { query } = block.input as { query: string };
          console.log(`[Nova] Searching knowledge base: "${query}"`);
          const results = await searchKnowledge(query, 5);
          if (results.length === 0)
            return "No relevant results found in the knowledge base.";
          return results
            .map((r) => `Source: ${r.filePath} > ${r.heading}\n${r.content}`)
            .join("\n---\n");
        }

        case "create_calendar_event": {
          const input = block.input as {
            summary: string;
            start_time: string;
            end_time: string;
            description?: string;
            attendees?: string[];
          };
          console.log(`[Nova] Creating calendar event: "${input.summary}"`);
          const link = await createCalendarEvent({
            summary: input.summary,
            startTime: input.start_time,
            endTime: input.end_time,
            description: input.description,
            attendees: input.attendees,
          });
          return `Calendar event created successfully. Link: ${link}`;
        }

        case "search_email": {
          const { query, max_results } = block.input as {
            query: string;
            max_results?: number;
          };
          console.log(`[Nova] Searching email: "${query}"`);
          const emails = await searchEmail(query, max_results ?? 5);
          if (emails.length === 0)
            return "No emails found matching that query.";
          return emails
            .map(
              (e) =>
                `From: ${e.from}\nDate: ${e.date}\nSubject: ${e.subject}\n${e.snippet}`
            )
            .join("\n---\n");
        }

        case "write_note": {
          const { filename, content, append } = block.input as {
            filename: string;
            content: string;
            append?: boolean;
          };
          console.log(`[Nova] Writing note: "${filename}"`);
          return await writeNote({ filename, content, append });
        }

        case "send_email": {
          const { to, subject, body, cc } = block.input as {
            to: string[];
            subject: string;
            body: string;
            cc?: string[];
          };
          console.log(`[Nova] Sending email to: ${to.join(", ")}`);
          return await sendEmail({ to, subject, body, cc });
        }

        case "search_web": {
          const { query, max_results } = block.input as {
            query: string;
            max_results?: number;
          };
          console.log(`[Nova] Web search: "${query}"`);
          const results = await searchWeb(query, max_results ?? 3);
          if (results.length === 0) return "No web results found.";
          return results
            .map((r) => `Title: ${r.title}\nURL: ${r.url}\n${r.content}`)
            .join("\n---\n");
        }

        case "list_calendar_events": {
          const { hours_ahead, max_results } = block.input as {
            hours_ahead?: number;
            max_results?: number;
          };
          console.log(`[Nova] Listing calendar events (next ${hours_ahead ?? 24}h)`);
          const events = await listCalendarEvents({
            hoursAhead: hours_ahead,
            maxResults: max_results,
          });
          if (events.length === 0) return "No upcoming events found in that window.";
          return events
            .map((e) => {
              const start = new Date(e.start).toLocaleString();
              const attendees = e.attendees.length
                ? `Attendees: ${e.attendees.join(", ")}`
                : "No attendees listed";
              const link = e.meetLink ? `\nMeet link: ${e.meetLink}` : "";
              return `${e.summary}\nStart: ${start}\n${attendees}${link}`;
            })
            .join("\n---\n");
        }

        case "read_note": {
          const { filename, list_notes: doList } = block.input as {
            filename?: string;
            list_notes?: boolean;
          };
          if (doList || !filename) {
            console.log("[Nova] Listing vault notes");
            const names = await listNotes();
            if (names.length === 0) return "No notes found in the vault.";
            return `Available notes:\n${names.map((n) => `- ${n}`).join("\n")}`;
          }
          console.log(`[Nova] Reading note: "${filename}"`);
          return await readNote(filename);
        }

        default:
          return `Unknown tool: ${block.name}`;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Nova] Tool error (${block.name}):`, message);
      return `Error executing ${block.name}: ${message}`;
    }
  }
}
