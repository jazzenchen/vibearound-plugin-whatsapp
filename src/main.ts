#!/usr/bin/env node
/**
 * VibeAround WhatsApp Plugin — ACP Client
 *
 * Spawned by the Rust host as a child process.
 * Communicates via ACP protocol (JSON-RPC 2.0 over stdio).
 *
 * Uses Baileys (unofficial WhatsApp Web client) for WhatsApp connectivity.
 * Authentication via QR code scan on first run; session persisted to disk.
 */

import { runChannelPlugin } from "@vibearound/plugin-channel-sdk";

import { WhatsAppBot } from "./bot.js";
import { AgentStreamHandler } from "./agent-stream.js";

runChannelPlugin({
  name: "vibearound-whatsapp",
  version: "0.1.0",
  createBot: ({ agent, log, cacheDir }) =>
    new WhatsAppBot(agent, log, cacheDir),
  afterCreate: async (bot, log) => {
    const botInfo = await bot.probe();
    log("info", `bot identity: ${botInfo.name} (${botInfo.id})`);
  },
  createStreamHandler: (bot, log, verbose) =>
    new AgentStreamHandler(bot, log, verbose),
});
