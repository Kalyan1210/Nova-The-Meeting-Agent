# AI Meeting Agent — Product Brainstorm

**Date:** March 27, 2026

---

## Core Concept

An AI agent that joins video calls (Google Meet, Zoom) as a full participant — not a transcription bot. Listens continuously for full context, responds to voice commands, and executes actions during the call.

---

## Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Listening mode | Continuous (not wake-word) | Agent needs full conversational arc before a command lands |
| Output format | Hybrid — voice for conversation, chat for technical output | Agent infers intent, or user cues explicitly ("tell me" vs. "put that in chat") |
| Privacy / data governance | Local capture first; user audits before cloud inference | Product differentiator |

---

## Phased Build Approach

### Phase 1 — Knowledge Agent (Safe, Immediate Value)
- Read-only access to approved knowledge sources: Obsidian vault, Notion, OneNote, project docs
- Answers questions during calls: "What's our methodology for 2.1?" "What did we decide about X last quarter?"
- No write permissions — zero attack surface
- Proves concept and builds user trust before expanding capabilities

### Phase 2 — Scoped Write Access
- Add write operations one at a time: create GitHub issues, post to Slack, add calendar blocks
- Each write operation gated behind voice authentication (host voice only)
- Customers explicitly opt in to each permission category during setup

### Phase 3 — Full Agent Capabilities
- Broader integrations as trust and security tooling matures
- Potential agentic workflows: multi-step task execution from a single command

---

## Knowledge Infrastructure — Setup Guidance as Product

A key part of the license bundle is a playbook for structuring the customer's knowledge base so the agent can actually use it:

- How to organize Obsidian vaults for AI retrieval (folder structure, metadata, tagging)
- Best practices for Notion and OneNote as knowledge sources
- How to index institutional knowledge so the agent finds the right answer rather than hallucinating
- Framework for identifying what knowledge belongs in the vault vs. stays in email/Slack

**Product pitch reframe:** You're not just selling "AI agent software" — you're selling AI-native knowledge infrastructure. The agent is the end state; the real work is helping teams build clean, queryable knowledge systems. Consulting-grade value, justifies a stronger price point.

---

## Technical Architecture

**How the agent joins a meeting:**
- Agent gets a dedicated email identity (e.g., claude-agent@childmetrix.com)
- Added to meeting invites like any other participant
- Always-on background service (Mac Mini M4 as orchestration host) monitors calendar, joins via Google Meet API at meeting start

**Foundation:** Built on OpenClaw framework. Customers bring their own API keys — Claude, Whisper (STT), ElevenLabs or similar (TTS). Your cost is your time, not their usage.

**Current blocker:** OpenClaw Cowork and Dispatch restricted to `C:\Users\...` — D: drive and Obsidian vault unreachable for power users. Tracked in open GitHub tickets.

**STT cost model — two options (discussed 2026-03-27 with Kalyan):**
- Option A: Company provides Whisper API — simpler for customer, but risks runaway costs on long or frequent meetings
- Option B: Customer brings their own Whisper API key — gives customer control over usage and cost; preferred for "bring your own key" licensing model

---

## Security Model

- **Scoped service accounts:** Agent runs under credentials with granular permissions defined at setup. No permission = hard technical block, not a refusal.
- **Voice authentication:** Write operations (Phase 2+) only execute when host's voice is detected. Read queries from any participant are fine. Setup includes voice enrollment for account owner.
- **Phase 1 risk profile:** A read-only knowledge agent has almost no attack surface. Worst outcome from a bad actor on the call: an answer they could have Googled.

---

## What You're Selling

A self-hosted deployment bundle — not SaaS:

- Private Git repo with complete OpenClaw architecture preconfigured
- Calendar monitoring agent and Meet integration scripts
- Installer that walks users through connecting Google Workspace credentials and API keys
- Knowledge base setup playbook (Obsidian, Notion, OneNote)
- Ongoing updates, compatibility maintenance, support, and expanding skill library

**License value — what customers get ongoing:**
- Updates as Google Meet API, OpenClaw, and Claude API evolve
- Compatibility maintenance across a multi-part stack that will break
- Support when the agent fails to join a meeting at 9 AM before a client call
- Expanding skill library — GitHub issues today, Jira/Slack/etc. over time

---

## API Key Model — "Bring Your Own Key"

All third-party services use the customer's own API keys. Ongoing costs are essentially just your time — which is exactly what the license fee covers.

---

## Competitive Landscape

| Tool | What it does | Differentiator | Relevance |
|---|---|---|---|
| **Google Meet / Zoom / Teams** (native) | Built-in transcription, auto-summary, action items | Free, frictionless, no setup | Normalizing AI presence on calls — actually helps our product by reducing social friction |
| **Otter.ai** | Transcription + summary bot joins as participant | Real-time transcript, searchable | Passive — no agency, can't answer questions or take actions |
| **Notion AI** | Captures/synthesizes meeting transcripts | Integrates with Notion workspace | Retrospective only — no active participation during the call |
| **Granola.ai** | Local Mac app; captures system audio silently; enhances your rough notes with transcript | No bot joins the call — other participants don't know it's running | Solving a shrinking problem: as native platform transcription normalizes bot presence, Granola's "invisible" angle becomes less of a differentiator. Passive note tool, not an active agent. |
| **Gemini in Meet** | "Ask Gemini" box active during calls; can summarize recent conversation | Native Google integration | Closest existing analog to our concept — but locked to Google ecosystem, no knowledge base connection, no tool integrations |

**Key insight:** The social norm around AI in meetings is already shifting — Google Meet, Zoom, and Teams all have native transcription that people use without friction. The awkwardness of "there's an AI on this call" is dissolving on its own. Our differentiation is **capability** (active, agentic, connected), not invisibility. Granola is solving a problem that's rapidly becoming a non-problem.

---

## Legal / Proprietary Risks

- **Google:** Public Meet API use is defensible, but Google has Gemini to protect. Risk: tightened automation policies down the road.
- **Anthropic:** "Bring your own API key" keeps you out of reseller territory. Verify commercial terms before launch.

---

## Prioritization (decided 2026-03-27)

**Product before podcast.** Rationale:
- Easier to scope than a podcast
- Delivers immediate, tangible value
- The product itself could become podcast content once built
- Kalyan is exploring the concept and will outline scope and capacity

---

## Open Questions

- [ ] Voice authentication engine selection
- [ ] License vs. subscription pricing model
- [ ] Usage tier caps or flat-rate?
- [ ] Which knowledge base platforms to support at launch (Obsidian first?)

---

## Related

- [[OpenClaw]] — foundation framework
- Mac Mini M4 — planned orchestration host (arriving ~March 18–20, 2026)
