# Changelog

## [0.1.1] - 2026-07-14

### Fixed
- Address fleet-wide 405 rejection of new QR pairings (WhatsApp servers version-gate new web-client registrations; existing sessions were unaffected):
  - Bump baileys 7.0.0-rc.9 → 7.0.0-rc13.
  - Remove the stale hardcoded WA Web build pin (`[2, 3000, 1034074495]`).
  - Fetch the authoritative WA Web version from web.whatsapp.com at connect time (`fetchLatestWaWebVersion`) instead of relying on the Baileys bundled default, which can itself lag and break pairing (see WhiskeySockets/Baileys#2679). If the fetch fails, the connection falls back to the bundled default with a loud error log — never silently.
  - Drop the deprecated `printQRInTerminal` option; QR codes are still delivered via the `connection.update` handler.
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
