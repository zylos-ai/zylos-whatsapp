# Changelog

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
