---
name: whatsapp
version: 0.1.0
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
