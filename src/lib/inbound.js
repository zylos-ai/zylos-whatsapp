/**
 * Pure helpers for inbound message handling (no Baileys / fs side effects),
 * kept separate so they can be unit-tested without a live connection.
 */

import os from 'os';
import path from 'path';

/**
 * Clock-skew allowance when comparing a message's WhatsApp server timestamp
 * against our local connection-open time.
 */
export const OWNER_BIND_GRACE_MS = 60 * 1000;

/**
 * Normalize a Baileys messageTimestamp (number | Long | string, in seconds)
 * to epoch milliseconds, or null when absent/invalid.
 */
/**
 * True only for a private one-to-one user JID: a phone-number JID
 * (`<digits>[:device]@s.whatsapp.net`) or a LID (`<digits>[:device]@lid`).
 * Groups (@g.us), newsletters (@newsletter), broadcasts / status (@broadcast),
 * calls and anything else are not people and must never become owner.
 */
export function isPrivateUserJid(jid) {
  if (typeof jid !== 'string') return false;
  return /^\d+(:\d+)?@(s\.whatsapp\.net|lid)$/.test(jid);
}

export function messageTimestampMs(ts) {
  if (ts === null || ts === undefined || ts === '') return null;
  const n = typeof ts?.toNumber === 'function' ? ts.toNumber() : Number(ts);
  return Number.isFinite(n) && n > 0 ? n * 1000 : null;
}

/**
 * Decide whether an inbound message may auto-bind the owner.
 *
 * Only a real-time DM received on the current live connection may bind.
 * Anything replayed after linking — offline backlog (Baileys upsert type
 * 'append'), placeholder-resend replays (type 'notify' but carrying a
 * requestId), or any message stamped before this connection opened — must
 * never bind, otherwise whichever stranger happened to message the number
 * earlier becomes owner and, under dmPolicy=owner, locks everyone else out.
 *
 * Fails closed: missing timestamp or unknown connection time => no bind.
 * A legitimate owner whose first message is rejected simply binds on their
 * next live message.
 *
 * @param {object} p
 * @param {boolean} p.ownerBound      - an owner is already bound
 * @param {boolean} p.isGroup         - message is from a group chat
 * @param {string}  p.chatJid         - chat (remoteJid) of the message
 * @param {string}  p.senderJid       - resolved sender JID
 * @param {string}  p.upsertType      - Baileys messages.upsert type ('notify' | 'append')
 * @param {string}  [p.requestId]     - set on placeholder-resend replays
 * @param {*}       p.messageTimestamp - Baileys msg.messageTimestamp (seconds)
 * @param {number}  p.connectedAt     - epoch ms when the current connection opened
 * @param {number}  [p.graceMs]       - clock-skew allowance
 * @returns {boolean}
 */
export function shouldBindOwner({
  ownerBound,
  isGroup,
  chatJid,
  senderJid,
  upsertType,
  requestId,
  messageTimestamp,
  connectedAt,
  graceMs = OWNER_BIND_GRACE_MS
}) {
  if (ownerBound) return false;
  if (isGroup) return false;
  // Positively require a person-to-person chat: a fresh @newsletter or
  // @broadcast message is not a group but must not bind either.
  if (!isPrivateUserJid(chatJid) || !isPrivateUserJid(senderJid)) return false;
  if (upsertType !== 'notify') return false;
  if (requestId) return false;
  if (!Number.isFinite(connectedAt) || connectedAt <= 0) return false;
  const tsMs = messageTimestampMs(messageTimestamp);
  if (tsMs === null) return false;
  return tsMs >= connectedAt - graceMs;
}

/**
 * Absolute path to comm-bridge's c4-send.js for the running user.
 */
export function c4SendPath(homeDir = os.homedir()) {
  return path.join(homeDir, 'zylos/.claude/skills/comm-bridge/scripts/c4-send.js');
}

/**
 * Build the "reply via" command appended to messages forwarded to C4.
 */
export function buildReplyVia(endpoint, homeDir = os.homedir()) {
  return `node ${c4SendPath(homeDir)} "whatsapp" "${endpoint}"`;
}
