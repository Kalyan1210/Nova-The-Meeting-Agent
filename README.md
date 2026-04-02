# Nova — The Meeting Agent

A self-hosted AI agent that joins video calls as an active participant — listens continuously, answers questions from your knowledge base, and executes actions during the call.

## Prerequisites

- Node.js 22+
- Google Workspace account with Calendar API and Meet Media API enabled
- API keys: Anthropic (Claude), OpenAI (Whisper + Embeddings), ElevenLabs (TTS)
- An Obsidian vault (or other markdown knowledge base)

## Setup

1. Clone the repo and install dependencies:

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

3. Run the OAuth setup to get a Google refresh token:

```bash
npm run oauth-setup
```

4. Index your knowledge base:

```bash
npm run index-vault
```

5. Test the agent locally (text mode):

```bash
npm run test-agent
```

6. Start the full agent (calendar monitoring + meeting joining):

```bash
npm run dev
```

## What Nova Can Do

- **Answer questions** from your Obsidian knowledge base during meetings
- **Create calendar events** — "Nova, schedule a standup tomorrow at 10am"
- **Search email** — "Nova, any emails from Sarah about the proposal?"
- **Take notes** — "Nova, add that decision to our project notes"
- **Transcribe meetings** — continuous speech-to-text of all participants

## Structure

- `src/calendar/` — Google Calendar polling and event creation
- `src/meet/` — Google Meet Media API / WebRTC joining
- `src/audio/` — STT (Whisper) and TTS (ElevenLabs) pipeline
- `src/knowledge/` — Obsidian vault indexer, RAG retrieval, and note writing
- `src/agent/` — Claude-powered meeting agent with tool use
- `src/config/` — BYOK key management, OAuth setup
- `docs/` — product thinking and meeting notes

## Stack

Built with Claude (Anthropic), Whisper (OpenAI), ElevenLabs, and Google Workspace APIs. Customers bring their own API keys.
