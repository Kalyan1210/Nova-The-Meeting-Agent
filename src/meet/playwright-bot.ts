import { chromium, Browser, BrowserContext, Page } from "playwright";
import { EventEmitter } from "events";
import { env } from "../config/env.js";
import { loadCookies, saveCookies } from "../config/cookie-store.js";

// ─────────────────────────────────────────────────────────────────────────────
// Browser-side init script (runs in page context before any page JS).
// Handles three things:
//   1. Override getUserMedia → return avatar canvas (video) + controlled audio stream (mic)
//   2. Intercept RTCPeerConnection → capture inbound participant audio and forward to Node.js
//   3. Expose __injectAudio() and __novaSetSpeaking() for Nova's TTS output
// ─────────────────────────────────────────────────────────────────────────────
const BROWSER_INIT_SCRIPT = /* js */ `
(function () {
  // ── Avatar canvas ──────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');

  let speaking = false;
  let pulse = 0;
  let pulseDir = 1;

  function drawAvatar() {
    const cx = 320, cy = 220;

    // Background
    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, 640, 480);

    // Outer pulse ring (when speaking)
    if (speaking) {
      pulse += pulseDir * 1.2;
      if (pulse > 28) pulseDir = -1;
      if (pulse < 0)  { pulse = 0; pulseDir = 1; }

      const alpha = 0.55 - pulse / 70;
      ctx.beginPath();
      ctx.arc(cx, cy, 148 + pulse, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(129, 140, 248, ' + alpha + ')';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Main circle — indigo gradient
    const grad = ctx.createRadialGradient(cx - 35, cy - 35, 15, cx, cy, 140);
    grad.addColorStop(0, '#a5b4fc');
    grad.addColorStop(1, '#4338ca');
    ctx.beginPath();
    ctx.arc(cx, cy, 140, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();

    // Subtle inner shadow
    ctx.beginPath();
    ctx.arc(cx, cy, 140, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 6;
    ctx.stroke();

    // "N" glyph
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 128px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', cx, cy - 4);

    // Name label
    ctx.font = '600 30px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText('Nova', cx, cy + 178);

    // Speaking / listening label
    ctx.font = '400 20px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = speaking ? '#a5b4fc' : 'rgba(255,255,255,0.35)';
    ctx.fillText(speaking ? '● Speaking' : '◎ Listening', cx, cy + 214);

    requestAnimationFrame(drawAvatar);
  }
  drawAvatar();

  window.__novaSetSpeaking = function (val) { speaking = !!val; };

  // ── Controlled audio context for Nova's outbound speech ───────────────────
  let audioCtx = null;
  let audioDest = null;

  function ensureAudioCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
      audioDest = audioCtx.createMediaStreamDestination();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  window.__injectAudio = async function (base64Mpeg) {
    ensureAudioCtx();
    try {
      const bin = atob(base64Mpeg);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

      const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
      const source = audioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioDest);
      source.start();
    } catch (e) {
      console.warn('[Nova] Audio injection error:', e);
    }
  };

  // ── getUserMedia override — return avatar canvas + Nova's audio stream ─────
  const _origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

  navigator.mediaDevices.getUserMedia = async function (constraints) {
    const stream = new MediaStream();

    if (constraints && constraints.video) {
      const videoStream = canvas.captureStream(30);
      videoStream.getVideoTracks().forEach(t => stream.addTrack(t));
    }

    if (constraints && constraints.audio) {
      ensureAudioCtx();
      audioDest.stream.getAudioTracks().forEach(t => stream.addTrack(t));
    }

    return stream;
  };

  // ── RTCPeerConnection intercept — capture inbound audio ───────────────────
  const _OrigRTC = window.RTCPeerConnection;

  function NovaRTCPeerConnection(...args) {
    const pc = new _OrigRTC(...args);

    pc.addEventListener('track', function (e) {
      if (e.track.kind !== 'audio') return;

      // 16 kHz matches Whisper's expected sample rate
      const remoteCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
      const source = remoteCtx.createMediaStreamSource(new MediaStream([e.track]));

      // ScriptProcessorNode is deprecated but has universal Meet support
      const processor = remoteCtx.createScriptProcessor(2048, 1, 1);
      processor.onaudioprocess = function (evt) {
        const f32 = evt.inputBuffer.getChannelData(0);
        // Skip silent frames to reduce bandwidth
        let energy = 0;
        for (let i = 0; i < f32.length; i++) energy += f32[i] * f32[i];
        if (energy / f32.length < 0.0001) return;

        const i16 = new Int16Array(f32.length);
        for (let i = 0; i < f32.length; i++) {
          i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32767));
        }
        if (window.__novaAudioCallback) {
          window.__novaAudioCallback(Array.from(i16));
        }
      };

      source.connect(processor);
      processor.connect(remoteCtx.destination);
    });

    return pc;
  }

  NovaRTCPeerConnection.prototype = _OrigRTC.prototype;
  Object.assign(NovaRTCPeerConnection, _OrigRTC);
  window.RTCPeerConnection = NovaRTCPeerConnection;

  // ── Chat message observer ──────────────────────────────────────────────────
  function startChatObserver() {
    const seen = new Set();

    const observer = new MutationObserver(() => {
      const msgs = document.querySelectorAll('[data-message-id]');
      msgs.forEach(el => {
        const id = el.getAttribute('data-message-id');
        if (!id || seen.has(id)) return;
        seen.add(id);

        const senderEl = el.querySelector('[data-sender-email]') ||
                         el.querySelector('[data-self-name]');
        const textEl = el.querySelector('[data-message-text]') ||
                       el.querySelector('.GDhqjd');

        const sender = senderEl?.getAttribute('data-sender-email') ||
                       senderEl?.textContent?.trim() || 'unknown';
        const text = textEl?.textContent?.trim() || '';

        if (text && window.__novaChatCallback) {
          window.__novaChatCallback(sender, text);
        }
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // ── Participant join observer ───────────────────────────────────────────────
  function startParticipantObserver() {
    const knownParticipants = new Set();

    // Seed initial set so we don't fire for people already in the room
    function seedInitial() {
      const nameSelectors = [
        '[data-self-name]',
        '.zWGUib',          // Google Meet participant name class
        '[data-participant-id] span',
      ];
      nameSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          const name = el.textContent?.trim();
          if (name) knownParticipants.add(name);
        });
      });
    }
    seedInitial();

    const observer = new MutationObserver(() => {
      const nameSelectors = ['[data-self-name]', '.zWGUib'];
      nameSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
          const name = el.textContent?.trim();
          if (name && !knownParticipants.has(name)) {
            knownParticipants.add(name);
            if (window.__novaParticipantJoined) {
              window.__novaParticipantJoined(name);
            }
          }
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Start observers after DOM is ready and meeting UI has loaded
  function startAll() {
    startChatObserver();
    // Delay participant observer so the initial room state is seeded correctly
    setTimeout(startParticipantObserver, 6000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAll);
  } else {
    startAll();
  }

})();
`;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Playwright-based Google Meet bot.
 *
 * Joins a Meet call as Nova, presents an animated avatar (no blank screen),
 * captures participant audio, and injects Nova's synthesized speech.
 *
 * Emits the same events as MeetMediaConnection so src/index.ts works unchanged:
 *   'audio'        (frame: Buffer)          — PCM audio from participants
 *   'chat'         (sender: string, text)   — chat message from participant
 *   'disconnected' ()                       — meeting ended
 */
export class PlaywrightMeetBot extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private _speaking = false;

  async join(meetLink: string): Promise<void> {
    this.browser = await chromium.launch({
      headless: env.meet.headless,
      args: [
        "--use-fake-ui-for-media-stream",           // Auto-grant cam/mic
        "--use-fake-device-for-media-stream",       // Use virtual devices
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });

    this.context = await this.browser.newContext({
      permissions: ["camera", "microphone"],
      viewport: { width: 1280, height: 720 },
    });

    // Restore saved Google session cookies
    const cookies = await loadCookies();
    if (cookies.length > 0) {
      await this.context.addCookies(cookies);
      console.log(`[PlaywrightBot] Loaded ${cookies.length} session cookies.`);
    } else {
      console.warn(
        "[PlaywrightBot] No session cookies found. Run `npm run meet-auth` first."
      );
    }

    this.page = await this.context.newPage();

    // Inject avatar + audio bridge before any page JS runs
    await this.page.addInitScript(BROWSER_INIT_SCRIPT);

    // Expose Node.js callbacks that browser code will call
    await this.page.exposeFunction(
      "__novaAudioCallback",
      (pcmChunk: number[]) => {
        const buf = Buffer.from(new Int16Array(pcmChunk).buffer);
        this.emit("audio", buf);
      }
    );

    await this.page.exposeFunction(
      "__novaChatCallback",
      (sender: string, text: string) => {
        this.emit("chat", sender, text);
      }
    );

    await this.page.exposeFunction(
      "__novaParticipantJoined",
      (name: string) => {
        this.emit("participant-joined", name);
      }
    );

    // Forward browser console logs to Node.js for debugging
    this.page.on("console", (msg) => {
      const t = msg.type();
      if (t === "warning" || t === "error") {
        console.log(`[Browser:${t}] ${msg.text()}`);
      }
    });

    console.log(`[PlaywrightBot] Navigating to ${meetLink}`);
    await this.page.goto(meetLink, { waitUntil: "domcontentloaded", timeout: 30_000 });

    // Refresh cookies after navigation (Google may have updated them)
    await saveCookies(await this.context.cookies());

    await this.handleJoinFlow();

    // Open chat panel so the DOM is populated with messages
    await this.openChatPanel();

    // Start Playwright-native chat polling (more reliable than DOM observer)
    this.startChatPolling();

    this.watchDisconnect();

    console.log("[PlaywrightBot] Joined meeting. Nova is live.");
    this.emit("connected");
  }

  // ── Join flow ──────────────────────────────────────────────────────────────

  private async handleJoinFlow(): Promise<void> {
    const page = this.page!;

    // Turn off mic and camera toggles before joining
    // (Nova speaks via injection, not system mic)
    await this.tryClick(page, [
      '[aria-label*="Turn off microphone" i]',
      '[data-is-muted="false"][aria-label*="microphone" i]',
    ]);

    // Wait for join button, try multiple selectors
    const joinSelectors = [
      'button:has-text("Join now")',
      'button:has-text("Ask to join")',
      '[data-mdc-dialog-action="join"]',
      '[jsname="Qx7uuf"]',
    ];

    let joined = false;
    for (let attempt = 0; attempt < 3 && !joined; attempt++) {
      for (const sel of joinSelectors) {
        try {
          const btn = await page.$(sel);
          if (btn) {
            await btn.click();
            console.log(`[PlaywrightBot] Clicked: ${sel}`);
            joined = true;
            break;
          }
        } catch {
          // Try next
        }
      }
      if (!joined) await page.waitForTimeout(2000);
    }

    // Wait for meeting UI to fully load
    await page.waitForTimeout(3000);
  }

  private async tryClick(page: Page, selectors: string[]): Promise<void> {
    for (const sel of selectors) {
      try {
        const el = await page.$(sel);
        if (el) {
          await el.click();
          return;
        }
      } catch {
        // Continue
      }
    }
  }

  // ── Audio / chat outbound ──────────────────────────────────────────────────

  /**
   * Inject Nova's synthesized MPEG audio into the meeting.
   * The browser decodes it via AudioContext and routes it to the WebRTC mic track.
   */
  sendAudio(mpeg: Buffer): void {
    if (!this.page) return;

    const b64 = mpeg.toString("base64");

    this.page
      .evaluate((data: string) => {
        (window as any).__novaSetSpeaking(true);
        return (window as any).__injectAudio(data);
      }, b64)
      .then(() => {
        // Mark as not-speaking after estimated playback duration
        // (rough estimate: 1 byte ≈ 0.04ms of 320kbps MPEG)
        const durationMs = Math.max(1000, (mpeg.length / 40000) * 1000);
        setTimeout(() => {
          this.page
            ?.evaluate(() => (window as any).__novaSetSpeaking(false))
            .catch(() => {});
        }, durationMs);
      })
      .catch((err) => console.error("[PlaywrightBot] sendAudio error:", err));
  }

  /**
   * Type a message into the Meet chat panel.
   */
  async sendChat(message: string): Promise<void> {
    if (!this.page) return;
    try {
      // Open chat panel if not already open
      const chatSelectors = [
        '[aria-label*="Chat with everyone" i]',
        '[data-tooltip*="Chat" i]',
        '[jsname="A5il2e"]',
      ];
      await this.tryClick(this.page, chatSelectors);
      await this.page.waitForTimeout(600);

      // Find input and type
      const inputSelectors = [
        '[aria-label*="Send a message" i]',
        'textarea[data-send-on-enter]',
        '[contenteditable="true"][aria-label*="message" i]',
      ];
      for (const sel of inputSelectors) {
        try {
          const input = await this.page.$(sel);
          if (input) {
            await input.fill(message);
            await input.press("Enter");
            return;
          }
        } catch {
          // Continue
        }
      }
    } catch (err) {
      console.error("[PlaywrightBot] sendChat error:", err);
    }
  }

  // ── Chat panel ────────────────────────────────────────────────────────────

  private async openChatPanel(): Promise<void> {
    const page = this.page!;
    const chatButtonSelectors = [
      '[aria-label*="Chat with everyone" i]',
      '[aria-label*="chat" i][role="button"]',
      '[data-tooltip*="Chat" i]',
      '[jsname="A5il2e"]',
      'button[jsname="A5il2e"]',
    ];
    await this.tryClick(page, chatButtonSelectors);
    await page.waitForTimeout(1000);
    console.log("[PlaywrightBot] Chat panel opened.");
  }

  /**
   * Poll the page every 2 seconds for new chat messages.
   * More reliable than MutationObserver because it doesn't depend on
   * specific DOM selectors being available at the right moment.
   */
  private startChatPolling(): void {
    const seen = new Set<string>();

    const poll = async () => {
      if (!this.page) return;
      try {
        const messages = await this.page.evaluate(() => {
          const results: Array<{ id: string; sender: string; text: string }> =
            [];

          // Strategy 1: data-message-id (older Meet versions)
          document.querySelectorAll("[data-message-id]").forEach((el) => {
            const id = el.getAttribute("data-message-id") || "";
            const sender =
              el
                .querySelector("[data-sender-email]")
                ?.getAttribute("data-sender-email") ||
              el.querySelector("[data-self-name]")?.textContent?.trim() ||
              "unknown";
            const text =
              el.querySelector("[data-message-text]")?.textContent?.trim() ||
              el.querySelector(".GDhqjd")?.textContent?.trim() ||
              "";
            if (id && text) results.push({ id, sender, text });
          });

          // Strategy 2: jsname-based (newer Meet versions)
          document.querySelectorAll('[jsname="xySENc"]').forEach((el, i) => {
            const text = el.textContent?.trim() || "";
            const senderEl = el
              .closest('[jsname="Imjpbc"]')
              ?.querySelector('[jsname="r4nke"]');
            const sender = senderEl?.textContent?.trim() || "unknown";
            const id = `jsname-${i}-${text.slice(0, 30)}`;
            if (text) results.push({ id, sender, text });
          });

          // Strategy 3: chat list items with role
          document
            .querySelectorAll('[data-is-bot-message], [data-message-text]')
            .forEach((el) => {
              const id =
                el.getAttribute("data-message-id") ||
                `attr-${el.textContent?.slice(0, 30)}`;
              const text = el.textContent?.trim() || "";
              if (text) results.push({ id, sender: "unknown", text });
            });

          return results;
        });

        for (const msg of messages) {
          const key = `${msg.sender}:${msg.text}`;
          if (!seen.has(key) && msg.text.trim()) {
            seen.add(key);
            console.log(`[Chat captured] ${msg.sender}: ${msg.text}`);
            this.emit("chat", msg.sender, msg.text);
          }
        }
      } catch {
        // Page closed or navigated — polling will stop via interval clear
      }
    };

    const interval = setInterval(poll, 2000);
    this.page!.on("close", () => clearInterval(interval));
  }

  // ── Disconnection monitor ──────────────────────────────────────────────────

  private watchDisconnect(): void {
    if (!this.page) return;

    this.page.on("close", () => {
      console.log("[PlaywrightBot] Browser page closed.");
      this.emit("disconnected");
    });

    const interval = setInterval(async () => {
      if (!this.page) { clearInterval(interval); return; }
      try {
        const leftEl = await this.page.$("text=/you've left|left the call/i");
        if (leftEl) {
          clearInterval(interval);
          console.log("[PlaywrightBot] Meeting ended.");
          this.emit("disconnected");
          await this.browser?.close().catch(() => {});
        }
      } catch {
        clearInterval(interval);
      }
    }, 5000);
  }

  async disconnect(): Promise<void> {
    console.log("[PlaywrightBot] Disconnecting.");
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.context = null;
    this.page = null;
    this.emit("disconnected");
  }
}
