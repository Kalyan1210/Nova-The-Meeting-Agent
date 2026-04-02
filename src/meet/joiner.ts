import { google } from "googleapis";
import { createOAuth2Client } from "../config/google-auth.js";
import { EventEmitter } from "events";

export interface MeetSession {
  meetingCode: string;
  spaceName: string;
}

/**
 * Joins a Google Meet call using the Meet Media API.
 *
 * The Meet Media API (Developer Preview) provides WebRTC-based access
 * to meeting audio/video streams. This module handles:
 * - Resolving a Meet link to a meeting space
 * - Establishing a WebRTC peer connection
 * - Exposing inbound audio (participants) and accepting outbound audio (agent)
 *
 * Prerequisite: enrollment in the Google Workspace Developer Preview Program.
 */
export class MeetJoiner extends EventEmitter {
  private auth = createOAuth2Client();

  /**
   * Extract the meeting code from a Google Meet URL.
   * Handles formats like:
   *   https://meet.google.com/abc-defg-hij
   *   https://meet.google.com/abc-defg-hij?authuser=0
   */
  parseMeetLink(url: string): string {
    const match = url.match(/meet\.google\.com\/([a-z\-]+)/i);
    if (!match) throw new Error(`Invalid Meet link: ${url}`);
    return match[1];
  }

  /**
   * Look up the meeting space resource via the Meet REST API.
   */
  async resolveSpace(meetingCode: string): Promise<MeetSession> {
    const meet = google.meet({ version: "v2", auth: this.auth });
    const res = await meet.spaces.get({
      name: `spaces/${meetingCode}`,
    });

    return {
      meetingCode,
      spaceName: res.data.name ?? `spaces/${meetingCode}`,
    };
  }

  /**
   * Join the meeting and establish a WebRTC media connection.
   *
   * This is the integration point for the Google Meet Media API
   * TypeScript reference client. The actual WebRTC signaling,
   * SDP offer/answer, and DTLS handshake are handled by the
   * reference client from googleworkspace/meet-media-api-samples.
   *
   * Returns an object with methods to interact with the media streams.
   */
  async join(meetLink: string): Promise<MeetMediaConnection> {
    const meetingCode = this.parseMeetLink(meetLink);
    console.log(`[MeetJoiner] Resolving space for code: ${meetingCode}`);
    const session = await this.resolveSpace(meetingCode);
    console.log(`[MeetJoiner] Space resolved: ${session.spaceName}`);

    const connection = new MeetMediaConnection(session, this.auth);
    await connection.connect();
    return connection;
  }
}

/**
 * Represents an active WebRTC connection to a Google Meet call.
 *
 * In production this wraps the Meet Media API reference client.
 * The current implementation provides the interface contract
 * that the audio pipeline depends on.
 */
export class MeetMediaConnection extends EventEmitter {
  private connected = false;

  constructor(
    public readonly session: MeetSession,
    private auth: InstanceType<typeof google.auth.OAuth2>
  ) {
    super();
  }

  async connect(): Promise<void> {
    // TODO: Integrate the Meet Media API TypeScript reference client here.
    //
    // The reference client handles:
    //   1. POST to create a media session (SDP offer)
    //   2. Process SDP answer from Meet servers
    //   3. ICE candidate exchange
    //   4. DTLS handshake
    //   5. SRTP media flow
    //
    // Once connected, inbound audio frames are emitted as 'audio' events.
    // Outbound audio is sent via sendAudio().

    console.log(
      `[MeetMediaConnection] Connecting to ${this.session.spaceName}...`
    );
    console.log(
      "[MeetMediaConnection] NOTE: Meet Media API integration pending — " +
        "requires Developer Preview enrollment and reference client setup."
    );

    this.connected = true;
    this.emit("connected", this.session);
  }

  /**
   * Send audio data to the meeting (agent's voice).
   * Accepts PCM audio frames that will be encoded and sent over WebRTC.
   */
  sendAudio(pcmData: Buffer): void {
    if (!this.connected) throw new Error("Not connected to meeting");
    // TODO: Feed pcmData into the WebRTC outbound audio track
    this.emit("audioSent", pcmData.length);
  }

  /**
   * Send a text message to the meeting chat.
   */
  async sendChat(message: string): Promise<void> {
    if (!this.connected) throw new Error("Not connected to meeting");
    // TODO: Use Meet REST API or Media API to post to meeting chat
    console.log(`[MeetMediaConnection] Chat: ${message}`);
  }

  async disconnect(): Promise<void> {
    console.log("[MeetMediaConnection] Disconnecting...");
    this.connected = false;
    this.emit("disconnected");
  }
}
