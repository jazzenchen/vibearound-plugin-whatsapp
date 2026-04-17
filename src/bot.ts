/**
 * WhatsAppBot — Baileys-based WhatsApp bot wrapper.
 *
 * Handles:
 *   - WebSocket connection to WhatsApp via Baileys
 *   - QR code authentication (displayed in terminal)
 *   - Inbound message parsing → ACP prompt() to Host
 *   - Outbound message sending
 */

import path from "node:path";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion, type proto } from "baileys";
import qrcode from "qrcode-terminal";
import type { Agent, ContentBlock } from "@vibearound/plugin-channel-sdk";
import type { AgentStreamHandler } from "./agent-stream.js";

type LogFn = (level: string, msg: string) => void;

export class WhatsAppBot {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private agent: Agent;
  private log: LogFn;
  private cacheDir: string;
  private authDir: string;
  private streamHandler: AgentStreamHandler | null = null;
  private stopped = false;
  private retryCount = 0;

  constructor(agent: Agent, log: LogFn, cacheDir: string) {
    this.agent = agent;
    this.log = log;
    this.cacheDir = cacheDir;
    this.authDir = path.join(cacheDir, "whatsapp-auth");
  }

  setStreamHandler(handler: AgentStreamHandler): void {
    this.streamHandler = handler;
  }

  /** Start the WhatsApp connection. Displays QR code for first-time auth. */
  async start(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

    // Fetch latest WA Web version to avoid "cannot link device" errors
    let version: [number, number, number] | undefined;
    try {
      const latest = await fetchLatestBaileysVersion();
      version = latest.version as [number, number, number];
      this.log("info", `using WA version: ${version.join(".")}`);
    } catch {
      this.log("warn", "failed to fetch latest version, using default");
    }

    const socket = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      browser: Browsers.ubuntu("VibeAround"),
    });
    this.socket = socket;

    // Handle QR code for authentication
    socket.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.log("info", "scan QR code to authenticate with WhatsApp:");
        qrcode.generate(qr, { small: true }, (code) => {
          process.stderr.write(code + "\n");
        });
      }

      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        this.log("info", `connection closed, statusCode=${statusCode} reconnect=${shouldReconnect}`);
        if (shouldReconnect && !this.stopped) {
          // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
          const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30_000);
          this.retryCount++;
          this.log("info", `reconnecting in ${delay}ms (attempt ${this.retryCount})...`);
          setTimeout(() => this.start(), delay);
        }
      } else if (connection === "open") {
        this.log("info", "connected to WhatsApp");
        this.retryCount = 0; // reset on successful connection
      }
    });

    // Save credentials on update
    socket.ev.on("creds.update", saveCreds);

    // Handle incoming messages
    socket.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const msg of messages) {
        this.handleMessage(msg);
      }
    });
  }

  /** Probe bot identity (returns the authenticated JID). */
  async probe(): Promise<{ id: string; name: string }> {
    // Wait for connection
    await new Promise<void>((resolve) => {
      if (this.socket?.user) {
        resolve();
        return;
      }
      const check = setInterval(() => {
        if (this.socket?.user) {
          clearInterval(check);
          resolve();
        }
      }, 500);
      // Timeout after 2 minutes (QR scan may take time)
      setTimeout(() => { clearInterval(check); resolve(); }, 120_000);
    });

    const user = this.socket?.user;
    return {
      id: user?.id ?? "unknown",
      name: user?.name ?? "WhatsApp Bot",
    };
  }

  /** Stop the bot. */
  stop(): void {
    this.stopped = true;
    this.socket?.end(undefined);
  }

  /** Send a text message. */
  async sendMessage(jid: string, text: string): Promise<void> {
    if (!this.socket) throw new Error("Socket not connected");
    await this.socket.sendMessage(jid, { text });
  }

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  private async handleMessage(msg: proto.IWebMessageInfo): Promise<void> {
    const key = msg.key;
    if (!key) return;

    // Ignore messages from self
    if (key.fromMe) return;
    // Ignore status broadcasts
    if (key.remoteJid === "status@broadcast") return;

    const jid = key.remoteJid;
    if (!jid) return;

    const text = msg.message?.conversation
      ?? msg.message?.extendedTextMessage?.text
      ?? "";

    const hasMedia = !!(
      msg.message?.imageMessage
      || msg.message?.documentMessage
      || msg.message?.audioMessage
      || msg.message?.videoMessage
    );

    if (!text && !hasMedia) return;

    const chatId = jid;
    this.log("debug", `message chat=${chatId} text=${text.slice(0, 80)}`);

    const contentBlocks: ContentBlock[] = [];

    if (text) {
      contentBlocks.push({ type: "text", text });
    }

    if (hasMedia) {
      const mediaType = msg.message?.imageMessage ? "image"
        : msg.message?.videoMessage ? "video"
        : msg.message?.audioMessage ? "audio"
        : "file";
      if (!text) {
        contentBlocks.push({ type: "text", text: `The user sent ${mediaType === "image" ? "an image" : `a ${mediaType}`}.` });
      }
    }

    if (contentBlocks.length === 0) return;

    if (text && this.streamHandler?.consumePendingText(chatId, text)) {
      return;
    }

    this.streamHandler?.onPromptSent(chatId);

    try {
      const response = await this.agent.prompt({
        sessionId: chatId,
        prompt: contentBlocks,
      });
      this.log("info", `prompt done chat=${chatId} stopReason=${response.stopReason}`);
      await this.streamHandler?.onTurnEnd(chatId);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.log("error", `prompt failed chat=${chatId}: ${errMsg}`);
      await this.streamHandler?.onTurnError(chatId, errMsg);
    }
  }
}
