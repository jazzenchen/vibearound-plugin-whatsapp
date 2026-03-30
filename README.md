# VibeAround WhatsApp Plugin

A [VibeAround](https://github.com/anthropics/vibearound) channel plugin that bridges WhatsApp to AI coding agents via the [Agent Client Protocol](https://github.com/anthropics/agent-client-protocol).

Uses [Baileys](https://github.com/WhiskeySockets/Baileys) (unofficial WhatsApp Web client) for WhatsApp connectivity.

## Known Issue: Device Pairing Broken

> **Status: Not functional as of March 2026.**
>
> Baileys v7.0.0-rc.9 cannot complete the device-linking handshake with WhatsApp's current servers. Both QR code scanning and pairing code authentication fail — the code is generated but WhatsApp rejects the cryptographic handshake.
>
> This is a confirmed upstream issue:
> - [WhiskeySockets/Baileys#2422](https://github.com/WhiskeySockets/Baileys/issues/2422) — QR code broken on iOS
> - [WhiskeySockets/Baileys#2370](https://github.com/WhiskeySockets/Baileys/issues/2370) — Connection Failure 405
> - [openclaw/openclaw#10491](https://github.com/openclaw/openclaw/issues/10491) — Same issue in OpenClaw
>
> **The plugin code is complete and correct.** Once Baileys ships a fix (new RC or stable v7), this plugin will work without changes.

## Features (when Baileys is fixed)

- **Send-only mode** — each block sent as a separate message (no message editing)
- **Pairing code authentication** — enter a code on your phone to link
- **Session persistence** — credentials saved locally, re-scan not needed
- **Exponential backoff** — auto-reconnect on disconnect
- **Media support** — receive images, documents, audio, video
- **Built with** [@vibearound/plugin-channel-sdk](https://www.npmjs.com/package/@vibearound/plugin-channel-sdk)

## Setup (for when it works)

1. Add to `~/.vibearound/settings.json`:

```json
{
  "channels": {
    "whatsapp": {
      "verbose": {
        "show_thinking": false,
        "show_tool_use": false
      }
    }
  }
}
```

2. Start VibeAround — the plugin will generate a pairing code in the logs
3. WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead
4. Enter the pairing code

## Development

```bash
npm install
npm run build
```

## License

MIT
