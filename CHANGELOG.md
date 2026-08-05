# Changelog

## [0.3.0] - 2026-08-05

### Fixed
- **Every outbound message knocked the resident listener offline.** WhatsApp Web
  allows one active session per device registration. `scripts/send.js` opened its
  own Baileys connection from the same `auth_info/` on each send, so WhatsApp
  answered the second registration by sending
  `stream:error / conflict: type=replaced` to the connection that already
  existed — terminating the service's stream and losing inbound messages for the
  ~4s it took to reconnect. Observed on a live host as a 1:1 correlation: five
  sends, five conflict-and-reconnect cycles, each 2-3 seconds after the send.

  Outbound now goes through a local Unix socket (`send.sock`, owner-only,
  authenticated with the existing `.internal-token`) to the process that already
  holds the session. `send.js` connects inline **only** when nothing is listening
  (fresh install, service stopped, mid-restart) — i.e. when there is no session
  to disrupt. A failure reported *by* the service is not retried inline, since
  that would recreate the conflict.

  This is also the most likely cause of "reconnect needs two QR scans, the second
  fails" reports: repeated conflicting registrations against one credential set.

### Added
- `src/lib/ipc.js` — send socket server/client plus `createSendHandler()`.
- `npm test` — `node --test` suite covering the send-socket contract (9 tests):
  round-trip delivery, media payloads, owner-only socket mode, service-reported
  failures surfacing as real errors rather than "unavailable", request
  validation, and stale-socket recovery after a crash.

### Changed
- `CLAUDE.md` documents the one-session-per-registration constraint and the rule
  that short-lived processes must not open a Baileys connection while the service
  is running.

## [0.2.1] - 2026-08-04

### Fixed
- **Reconnect after a WhatsApp-side logout never generated a new QR code.**
  On `DisconnectReason.loggedOut`, the `connection.update` handler only
  logged a message telling an operator to delete `auth_info` manually — it
  never did so itself, and never reconnected. The next start (triggered by a
  pm2 restart from cws-connect's channel-reconnect dispatch) called
  `useMultiFileAuthState` on the same already-revoked credentials and
  attempted session *resumption* instead of fresh pairing, hitting the
  identical `loggedOut` failure again — the process never reached a state
  that emits a QR, so a customer clicking "Connect" on a logged-out WhatsApp
  channel got no QR code, silently, forever.
  - `loggedOut` now clears `auth_info/` immediately (this is WhatsApp's own
    definitive "this session is dead" signal — there is nothing left in it
    worth preserving) and reconnects through the same hardened path already
    used for the retryable-disconnect case (bounded teardown, shared caches,
    exponential backoff), so the next attempt is a genuine fresh QR pairing
    rather than a doomed resumption attempt.
  - No behavior change for any other disconnect reason — only the
    previously-dead-end `loggedOut` branch is affected. Built on top of the
    v0.2.0 reconnect-hardening work below, not a replacement for it.

## [0.2.0] - 2026-07-19

### Fixed
- Memory leak on reconnect (#3, PR #4): every `Reconnecting...` cycle leaked the previous socket and its caches, growing RSS by tens of MB per reconnect (150-200MB/hr on unstable networks) until OOM.
  - Tear down the old socket before creating a new one: remove all event listeners, end the WebSocket, and drop references (`teardownSocket`).
  - Share Baileys caches (msg retry counter, media conn, user devices, placeholder resend) as module-scope singletons across reconnects instead of creating per-connect instances — caller-provided NodeCaches were retained forever by their `checkperiod` timers even after the socket died. Raise the `@cacheable/node-cache` floor to `^1.7.6` (1.4.0 lacks the named `NodeCache` export and crashes at boot).
  - Add a PM2 `max_memory_restart: '1G'` backstop for residual growth from upstream Baileys issues (WhiskeySockets/Baileys#2090 per-entry LID cache timers, #2666 per-socket AsyncLocalStorage) that cannot be fixed component-side.
  - Live validation (same-PID SIGSTOP/CONT reconnect test, 5 cycles): +6MB total (~1.2MB/cycle, upstream residual) vs. tens of MB per cycle before the fix.

### Added
- Reconnect hardening (#5, #6, PR #7), modeled on OpenClaw's connection controller and verified against Baileys 7.0.0-rc13 source:
  - Exponential reconnect backoff: 2s → 30s cap (×1.8 growth, ±25% jitter), 12-attempt limit, then `exit(1)` so PM2 takes over with a clean process. The counter resets only after the connection stays stable for 60s.
  - Bounded close verification: teardown now polls (up to 15s) until the old WebSocket is actually closed before a replacement socket is created, preventing two live sockets racing on the same auth state.
  - Passive transport watchdog: tracks WebSocket `frame` timestamps; if no frame arrives for 5 minutes (meaning Baileys' own keepalive self-check — which pings every 25-30s and self-terminates after ~35s of silence — has itself died), forces the reconnect path via `sock.end()`, escalating to `exit(1)` if the socket is wedged. Deliberately passive: no active probing, no duplicate ping traffic, no race with teardown.
  - Tighten `keepAliveIntervalMs` to 25s (OpenClaw's value) to survive aggressive NAT idle timeouts.

## [0.1.2] - 2026-07-14

### Fixed
- Normalize all line endings to LF and add `.gitattributes` (`* text=auto eol=lf`) to enforce it. The repo was committed with CRLF line endings, which broke zylos-core's SKILL.md frontmatter parsing (its `/^---\n([\s\S]*?)\n---/` regex does not tolerate `\r`): headless `zylos add whatsapp` silently skipped dependency installation, lifecycle hooks, and PM2 service registration, leaving a dependency-less component that crash-looped on `ERR_MODULE_NOT_FOUND` (dotenv). Fresh installs via the platform connect flow were 100% affected; upgrades were not (the upgrade path gates its npm step on `package.json` existence, not on parsed frontmatter).

## [0.1.1] - 2026-07-14

### Fixed
- Address fleet-wide 405 rejection of new QR pairings (WhatsApp servers version-gate new web-client registrations; existing sessions were unaffected):
  - Bump baileys 7.0.0-rc.9 → 7.0.0-rc13.
  - Remove the stale hardcoded WA Web build pin (`[2, 3000, 1034074495]`).
  - Fetch the authoritative WA Web version from web.whatsapp.com at connect time instead of relying on the Baileys bundled default, which can itself lag and break pairing (see WhiskeySockets/Baileys#2679). The fetch goes through the same proxy agent as the socket (`proxy` config / `WHATSAPP_PROXY`) with an explicit 15s timeout — Baileys' own `fetchLatestWaWebVersion()` helper does a bare global fetch that would bypass the proxy. On fetch failure: fresh auth (no completed pairing — neither `creds.registered` nor a paired `creds.account` identity; a real QR pairing writes `account`, not `registered`) refuses to attempt pairing and exits with an actionable error, since pairing with a stale version is the known 405/408 failure class; a session with completed pairing resumes on the bundled default with a loud error log — never silently.
  - Drop the deprecated `printQRInTerminal` option; QR codes are still delivered via the `connection.update` handler.
- Validated live end-to-end: fresh-device QR pairing (authoritative version fetch → QR → scan → connection open) plus a bidirectional message round-trip on a direct-network host, and clean session resume across a component restart.
- Remediation: upgrade the component, then retry QR pairing.

## [0.1.0] - 2026-03-10

### Added
- Initial release
- WhatsApp Web connection via Baileys (QR code login)
- DM and group message receiving with C4 bridge integration
- Text, image, and file sending via C4 send interface
- Access control: DM policies (open/allowlist/owner), group policies (disabled/allowlist/open)
- Owner auto-binding on first DM
- Admin CLI for config management
- Persistent auth session
- Auto-reconnect on disconnection
- Message deduplication
- Media download and forwarding
