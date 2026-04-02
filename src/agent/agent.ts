import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { TranscriptBuffer } from "./transcript.js";
import { searchKnowledge } from "../knowledge/store.js";
import { createCalendarEvent } from "../calendar/events.js";
import { searchEmail } from "./tools/email-search.js";
import { writeNote } from "../knowledge/writer.js";

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
];

export interface AgentResponse {
  text: string;
  channel: "voice" | "chat";
}

/**
 * Nova — core agent that processes meeting conversation and generates responses.
 * Uses Claude with tool use to query knowledge, create events, search email, and take notes.
 */
export class MeetingAgent {
  private transcript = new TranscriptBuffer();
  private model = "claude-sonnet-4-20250514";

  async processUtterance(
    speaker: string,
    text: string
  ): Promise<AgentResponse | null> {
    this.transcript.add(speaker, text);

    if (!this.shouldRespond(text)) return null;

    return this.generateResponse(text);
  }

  private shouldRespond(text: string): boolean {
    const lower = text.toLowerCase().trim();
    if (lower.includes("?")) return true;
    if (lower.includes("nova")) return true;

    const triggers = [
      "what", "how", "why", "when", "where", "who", "which",
      "can you", "could you", "do we", "does", "is there", "are there",
      "tell me", "explain", "help me",
      "schedule", "create", "add", "note", "write", "save",
      "search", "find", "check", "look up",
    ];
    return triggers.some((s) => lower.startsWith(s));
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
      system: SYSTEM_PROMPT,
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
        system: SYSTEM_PROMPT,
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
