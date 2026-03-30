# VibeAround WhatsApp Plugin

WhatsApp channel plugin for [VibeAround](https://github.com/anthropics/vibearound) — bridges WhatsApp to your AI agent via [ACP](https://github.com/anthropics/agent-client-protocol).

## Features

- Text messages and media (images, documents)
- QR code authentication (scan once, session persisted)
- Built on [Baileys](https://github.com/WhiskeySockets/Baileys) (unofficial WhatsApp Web API)

## Setup

1. Add to your VibeAround `settings.json`:

```json
{
  "channels": {
    "whatsapp": {}
  }
}
```

2. On first start, a QR code will appear in the terminal — scan it with your WhatsApp app (Settings > Linked Devices > Link a Device)

3. Session is saved to `~/.vibearound/.cache/whatsapp-auth/` and persists across restarts

## Limitations

- No message editing (WhatsApp doesn't support it) — responses are sent as sequential messages
- Unofficial library — may break if WhatsApp updates their protocol
- Moderate rate limits (~1-2k messages/day recommended)

## Development

```bash
bun install
bun run build
```

## License

MIT
