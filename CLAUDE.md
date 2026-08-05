# CLAUDE.md

Development guidelines for zylos-whatsapp.

## Project Conventions

- **ESM only** — Use `import`/`export`, never `require()`. All files use ES Modules (`"type": "module"` in package.json)
- **Node.js 20+** — Minimum runtime version
- **Conventional commits** — `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **Secrets in `.env` only** — Never commit secrets. Use `~/zylos/.env` for credentials, `config.json` for non-sensitive runtime config
- **English for code** — Comments, commit messages, PR descriptions, and documentation in English

## Architecture

Communication component using WhatsApp Web protocol via Baileys library.

- `src/index.js` — Main entry point (WhatsApp Web connection + C4 bridge)
- `src/admin.js` — Admin CLI (config, access control management)
- `src/lib/config.js` — Config loader with hot-reload
- `src/lib/whatsapp.js` — Baileys wrapper (connect, send, receive)
- `src/lib/ipc.js` — Local send socket (resident service ↔ short-lived CLI processes)
- `scripts/send.js` — C4 outbound message interface
- `test/` — `node --test` suite (`npm test`)
- `hooks/` — Lifecycle hooks (post-install, pre-upgrade, post-upgrade)
- `ecosystem.config.cjs` — PM2 service config

## Key Directories

- Code: `~/zylos/.claude/skills/whatsapp/` (overwritten on upgrade)
- Data: `~/zylos/components/whatsapp/` (preserved)
  - `config.json` — Runtime config
  - `auth_info/` — WhatsApp Web session (NEVER delete without user consent)
  - `media/` — Downloaded media files
  - `logs/` — Per-chat message logs
  - `send.sock` — Outbound send socket (owner-only; created by the service, removed on shutdown)
  - `.internal-token` — Shared secret authenticating send-socket requests

## One session per registration

WhatsApp Web allows a single active session per device registration. A second
Baileys connection built from the same `auth_info/` makes WhatsApp send
`stream:error / conflict: type=replaced` to the connection that already exists,
which drops the resident listener and loses inbound messages until it reconnects.

Therefore: **never open a Baileys connection from a short-lived process while the
service is running.** Outbound work goes through the send socket
(`src/lib/ipc.js` → `requestSend`), which hands the message to the process that
already holds the session. `scripts/send.js` only connects inline when no service
is listening (fresh install, service stopped) — i.e. when there is no session to
disrupt.
