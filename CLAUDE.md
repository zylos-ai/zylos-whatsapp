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
- `scripts/send.js` — C4 outbound message interface
- `hooks/` — Lifecycle hooks (post-install, pre-upgrade, post-upgrade)
- `ecosystem.config.cjs` — PM2 service config

## Key Directories

- Code: `~/zylos/.claude/skills/whatsapp/` (overwritten on upgrade)
- Data: `~/zylos/components/whatsapp/` (preserved)
  - `config.json` — Runtime config
  - `auth_info/` — WhatsApp Web session (NEVER delete without user consent)
  - `media/` — Downloaded media files
  - `logs/` — Per-chat message logs
