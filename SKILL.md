---
name: whatsapp
version: 0.3.1
description: >-
  WhatsApp communication channel via WhatsApp Web protocol (QR code login).
  Use when: (1) replying to WhatsApp messages (DM or group),
  (2) sending proactive messages or media (images, files) to WhatsApp users or groups,
  (3) managing DM access control (dmPolicy: open/allowlist/owner, dmAllowFrom list),
  (4) managing group access control (groupPolicy, per-group allowFrom),
  (5) configuring the bot (admin CLI, access policies),
  (6) troubleshooting WhatsApp connection or QR code scanning issues.
  Config at ~/zylos/components/whatsapp/config.json. Service: pm2 zylos-whatsapp.
type: communication

lifecycle:
  npm: true
  service:
    type: pm2
    name: zylos-whatsapp
    entry: src/index.js
  data_dir: ~/zylos/components/whatsapp
  hooks:
    post-install: hooks/post-install.js
    pre-upgrade: hooks/pre-upgrade.js
    post-upgrade: hooks/post-upgrade.js
  preserve:
    - config.json
    - auth_info/

upgrade:
  repo: zylos-ai/zylos-whatsapp
  branch: main

config:
  required: []
  optional:
    - name: dmPolicy
      description: "DM access policy (open|allowlist|owner, default: owner)"
    - name: groupPolicy
      description: "Group access policy (disabled|allowlist|open, default: disabled)"

dependencies:
  - comm-bridge
---

# WhatsApp Channel

## Sending Messages

Via C4 bridge:
```bash
node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "whatsapp" "<jid>|type:p2p|msg:<msgId>" "Hello"
```

Media:
```bash
node ~/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "whatsapp" "<jid>" "[MEDIA:image]/path/to/image.png"
```

## Session Groups (multi-session Core)

With a zylos-core that supports multi-session, each inbound message carries a
session group, so every private chat and every group gets its own
conversation thread. Replies still go through the same `reply via` path; the
endpoint format and `scripts/send.js` are unchanged.

| Conversation | Endpoint | Session group | Example |
|---|---|---|---|
| Private chat (phone number) | `<n>@s.whatsapp.net\|type:p2p\|msg:<id>` | `dm-<n>:s.whatsapp.net` | `dm-8613800138000:s.whatsapp.net` |
| Private chat (LID) | `<n>@lid\|type:p2p\|msg:<id>` | `dm-<n>:lid` | `dm-123456789012345:lid` |
| Group | `<id>@g.us\|type:group\|msg:<id>` | `group-<id>:g.us` | `group-120363012345678901:g.us` |

Core adds the `whatsapp:` namespace (e.g. `whatsapp:dm-8613800138000:s.whatsapp.net`).

- These rules are fixed. Group names are Core's memory keys, so changing them
  would need a migration together with Core.
- The JID keeps its domain with `@` replaced by `:`, so the same person seen as
  a phone number and as a LID gets two groups. Only `s.whatsapp.net` / `lid`
  JIDs map to `dm-` and only `g.us` JIDs to `group-`; newsletters, broadcasts
  and anything else are not mapped. A JID must contain exactly one `@` and no
  `:` (no device suffix). Ids are never truncated or hashed; an
  endpoint that cannot be mapped (or a name over 95 characters) is not sent to
  Core, and the chat is asked to try again later. It never falls back to the
  overall group.
- The group (and `--json`) is passed only if the installed Core lists
  `--session-group` in `c4-receive-options.json` (re-read on every message).
  Older Cores receive exactly the same arguments as before.
- If Core rejects a message, Core's text goes only to the log. The chat gets a
  "try again later" notice when Core stored nothing, a "may not have reached
  me" notice when the outcome is unknown, and nothing when Core already stored
  it; at most one notice per chat every 5 minutes, quoting the message in
  groups. The notice's own echo is never forwarded to Core (no loop in
  "Message Yourself"). c4-receive runs without a timeout and is retried (once,
  after 2s) only when the process could not be started. NUL bytes are removed
  from the content.

```bash
node ~/zylos/.claude/skills/whatsapp/scripts/session-group.js "<endpoint>"
# prints e.g. group-120363012345678901:g.us (without "whatsapp:"), exit 0
```

## Admin CLI

```bash
node ~/zylos/.claude/skills/whatsapp/src/admin.js show
node ~/zylos/.claude/skills/whatsapp/src/admin.js set-dm-policy <open|allowlist|owner>
node ~/zylos/.claude/skills/whatsapp/src/admin.js add-dm-allow <phone>
node ~/zylos/.claude/skills/whatsapp/src/admin.js set-group-policy <disabled|allowlist|open>
node ~/zylos/.claude/skills/whatsapp/src/admin.js add-group <jid> <name>
node ~/zylos/.claude/skills/whatsapp/src/admin.js clear-auth
```

## QR Code Login

1. Start the service: `pm2 start ecosystem.config.cjs`
2. Check logs: `pm2 logs zylos-whatsapp`
3. QR code will be printed in the terminal
4. Open WhatsApp on your phone → Linked Devices → Link a Device → Scan QR

Auth session is persisted in `~/zylos/components/whatsapp/auth_info/`.
To re-login: `node admin.js clear-auth` then restart the service.
