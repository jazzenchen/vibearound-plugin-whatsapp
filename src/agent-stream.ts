/**
 * AgentStreamHandler — receives ACP session updates from the Host and renders
 * them as separate WhatsApp messages, one per contiguous variant block.
 *
 * Extends BlockRenderer from @vibearound/plugin-channel-sdk which handles:
 *   - Block accumulation and kind-change detection
 *   - Verbose filtering (thinking / tool blocks)
 *
 * WhatsApp is send-only (no message editing).
 */

import {
  BlockRenderer,
  type BlockKind,
  type VerboseConfig,
} from "@vibearound/plugin-channel-sdk";
import type { WhatsAppBot } from "./bot.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogFn = (level: string, msg: string) => void;

// ---------------------------------------------------------------------------
// AgentStreamHandler
// ---------------------------------------------------------------------------

export class AgentStreamHandler extends BlockRenderer<string> {
  private bot: WhatsAppBot;
  private log: LogFn;
  private lastActiveChannelId: string | null = null;

  constructor(bot: WhatsAppBot, log: LogFn, verbose?: Partial<VerboseConfig>) {
    super({
      flushIntervalMs: 500,
      minEditIntervalMs: 0, // send-only, no throttle
      verbose,
    });
    this.bot = bot;
    this.log = log;
  }

  // ---- BlockRenderer overrides ----

  /** Prefix sessionId with "whatsapp:". */
  protected sessionIdToChannelId(sessionId: string): string {
    return `whatsapp:${sessionId}`;
  }

  /** WhatsApp uses plain text with emoji prefixes. */
  protected formatContent(kind: BlockKind, content: string, _sealed: boolean): string {
    switch (kind) {
      case "thinking": return `💭 ${content}`;
      case "tool":     return content.trim();
      case "text":     return content;
    }
  }

  /** Send block as a new message (no editing on WhatsApp). */
  protected async sendBlock(channelId: string, _kind: BlockKind, content: string): Promise<string | null> {
    try {
      await this.bot.sendMessage(channelId, content);
    } catch (e) {
      this.log("error", `sendBlock failed: ${e}`);
    }
    return null; // send-only
  }

  // No editBlock — WhatsApp doesn't support message editing

  /** Cleanup after turn. */
  protected async onAfterTurnEnd(_channelId: string): Promise<void> {
    // No-op
  }

  /** Send error message. */
  protected async onAfterTurnError(channelId: string, error: string): Promise<void> {
    this.bot.sendMessage(channelId, `❌ Error: ${error}`).catch((e) => {
      this.log("error", `send error notice failed: ${e}`);
    });
  }

  // ---- Prompt lifecycle ----

  onPromptSent(channelId: string): void {
    this.lastActiveChannelId = channelId;
    super.onPromptSent(channelId);
  }

  // ---- Host ext notification handlers ----

  onAgentReady(agent: string, version: string): void {
    const channelId = this.lastActiveChannelId;
    if (channelId) {
      this.bot.sendMessage(channelId, `🤖 Agent: ${agent} v${version}`).catch(() => {});
    }
  }

  onSessionReady(sessionId: string): void {
    const channelId = this.lastActiveChannelId;
    if (channelId) {
      this.bot.sendMessage(channelId, `📋 Session: ${sessionId}`).catch(() => {});
    }
  }

  onSystemText(text: string, channelId?: string): void {
    const target = channelId ?? this.lastActiveChannelId;
    if (!target) return;
    this.bot.sendMessage(target, text).catch((e) => {
      this.log("error", `send_system_text failed: ${e}`);
    });
  }
}
