# Changelog

## [0.1.1] - 2026-07-14

### Fixed
- Bump baileys 7.0.0-rc.9 → 7.0.0-rc13. WhatsApp's servers reject new web-client registrations from the old client build with status 405, so fresh QR pairings hung at "connecting" fleet-wide; existing sessions were unaffected. Also removed the stale hardcoded WA Web version override and the deprecated `printQRInTerminal` option (QR codes are still delivered via the `connection.update` handler). Remediation: after upgrading the component, retry the QR connect.

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
