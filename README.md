# zylos-whatsapp

WhatsApp communication channel for Zylos via WhatsApp Web protocol.

## Features

- QR code login (scan with your phone to connect)
- Receive and reply to DM and group messages
- Send text, images, and files
- Access control (DM policies, group allowlists)
- Persistent session (no re-scan needed after restart)
- Auto-reconnect on connection loss

## Quick Start

1. Install: `zylos add whatsapp`
2. Start service: `pm2 start ecosystem.config.cjs`
3. Check logs for QR code: `pm2 logs zylos-whatsapp`
4. Scan QR with WhatsApp on your phone

## Requirements

- Node.js 20+
- WhatsApp account on a phone

## License

MIT
