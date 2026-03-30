#!/usr/bin/env node
/**
 * WhatsApp standalone auth script for onboarding.
 *
 * Spawned by the Rust onboarding backend as a JSON-RPC subprocess.
 * Uses pairing code auth (QR is broken in Baileys v7.0.0-rc.9).
 *
 * JSON-RPC methods:
 *   initialize → handshake
 *   login_pair_start → connect + request pairing code for a phone number
 *   login_pair_wait → block until auth completes or timeout
 *   shutdown → clean exit
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline";
import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } from "baileys";

const authDir = path.join(os.homedir(), ".vibearound", ".cache", "whatsapp-auth");

function clearAuthState(): void {
  try {
    if (fs.existsSync(authDir)) {
      for (const file of fs.readdirSync(authDir)) {
        fs.unlinkSync(path.join(authDir, file));
      }
      log("cleared stale auth state");
    }
  } catch (e) {
    log(`failed to clear auth state: ${e}`);
  }
}

function log(msg: string): void {
  process.stderr.write(`[whatsapp-auth] ${msg}\n`);
}

function sendJson(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function sendResponse(id: number | string, result: unknown): void {
  sendJson({ jsonrpc: "2.0", id, result });
}

function sendError(id: number | string, message: string): void {
  sendJson({ jsonrpc: "2.0", id, error: { code: -1, message } });
}

// State
let connected = false;
let socket: ReturnType<typeof makeWASocket> | null = null;
let waitResolve: ((value: unknown) => void) | null = null;

async function startAndPair(phoneNumber: string): Promise<{ pairingCode: string | null; alreadyConnected: boolean; error?: string }> {
  clearAuthState();

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  let version: [number, number, number] | undefined;
  try {
    const latest = await fetchLatestBaileysVersion();
    version = latest.version as [number, number, number];
    log(`using WA version: ${version.join(".")}`);
  } catch {
    log("failed to fetch latest version, using default");
  }

  socket = makeWASocket({
    auth: state,
    ...(version ? { version } : {}),
    browser: Browsers.ubuntu("VibeAround"),
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (update) => {
    if (update.connection === "open") {
      log("connected to WhatsApp!");
      connected = true;
      if (waitResolve) {
        waitResolve({ connected: true, message: "WhatsApp connected successfully." });
        waitResolve = null;
      }
    }
    if (update.connection === "close") {
      const statusCode = (update.lastDisconnect?.error as any)?.output?.statusCode;
      log(`connection closed, statusCode=${statusCode}`);
      if (statusCode === DisconnectReason.loggedOut && waitResolve) {
        waitResolve({ connected: false, message: "WhatsApp session was logged out." });
        waitResolve = null;
      }
    }
  });

  // Wait for the socket to be ready for pairing code request
  await new Promise<void>((resolve) => setTimeout(resolve, 3000));

  if (connected) {
    return { pairingCode: null, alreadyConnected: true };
  }

  // Request pairing code
  try {
    const code = await socket.requestPairingCode(phoneNumber);
    log(`pairing code generated: ${code}`);
    return { pairingCode: code, alreadyConnected: false };
  } catch (e) {
    log(`pairing code error: ${e}`);
    return { pairingCode: null, alreadyConnected: false, error: String(e) };
  }
}

// JSON-RPC handler
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }

  const { id, method, params } = msg;

  switch (method) {
    case "initialize": {
      sendResponse(id, {
        protocolVersion: "2025-03-26",
        agentInfo: { name: "whatsapp-auth", version: "0.1.0" },
      });
      break;
    }

    case "login_pair_start": {
      const phoneNumber = params?.phoneNumber as string;
      if (!phoneNumber) {
        sendError(id, "phoneNumber is required (E.164 format without +)");
        break;
      }
      log(`starting pairing for phone: ${phoneNumber}`);
      // Kill previous socket
      if (socket) { socket.end(undefined); socket = null; }
      connected = false;
      waitResolve = null;

      try {
        const result = await startAndPair(phoneNumber);
        if (result.alreadyConnected) {
          sendResponse(id, {
            pairingCode: null,
            message: "WhatsApp is already authenticated.",
            alreadyConnected: true,
          });
        } else if (result.pairingCode) {
          sendResponse(id, {
            pairingCode: result.pairingCode,
            message: "Enter this code in WhatsApp to link your device.",
            alreadyConnected: false,
          });
        } else {
          sendResponse(id, {
            pairingCode: null,
            message: result.error || "Failed to generate pairing code.",
            alreadyConnected: false,
          });
        }
      } catch (e) {
        sendError(id, String(e));
      }
      break;
    }

    case "login_pair_wait": {
      const timeoutMs = params?.timeoutMs ?? 120000;

      if (connected) {
        sendResponse(id, { connected: true, message: "WhatsApp connected successfully." });
        break;
      }

      const result = await Promise.race([
        new Promise((resolve) => { waitResolve = resolve; }),
        new Promise((resolve) =>
          setTimeout(() => resolve({ connected: false, message: "Pairing timed out. Try again." }), timeoutMs)
        ),
      ]);

      waitResolve = null;
      sendResponse(id, result);
      break;
    }

    case "shutdown": {
      sendResponse(id, {});
      socket?.end(undefined);
      setTimeout(() => process.exit(0), 500);
      break;
    }

    default:
      sendError(id, `unknown method: ${method}`);
  }
});
