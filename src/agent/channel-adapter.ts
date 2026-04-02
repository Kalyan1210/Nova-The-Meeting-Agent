import { EventEmitter } from "events";
import { MeetingAgent, AgentResponse } from "./agent.js";

/**
 * Channel adapter that bridges the real-time meeting audio pipeline
 * into a message-oriented interface compatible with OpenClaw's
 * channel model.
 *
 * Each transcribed utterance from the audio pipeline becomes an
 * inbound message. Agent responses become outbound messages routed
 * back to the meeting (voice or chat).
 */
export class MeetingChannelAdapter extends EventEmitter {
  private agent: MeetingAgent;

  constructor(agent: MeetingAgent) {
    super();
    this.agent = agent;
  }

  /**
   * Process an inbound message (transcribed speech from meeting).
   * Emits 'response' if the agent generates a reply.
   */
  async onMessage(
    speaker: string,
    text: string
  ): Promise<AgentResponse | null> {
    const response = await this.agent.processUtterance(speaker, text);
    if (response) {
      this.emit("response", response);
    }
    return response;
  }
}
