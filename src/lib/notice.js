/**
 * Notices sent to a chat when the agent will not answer a message.
 */

export const NOTICE_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Create a function that sends a notice to a chat, at most once per chat per
 * cooldown: allowed groups forward every member message, so a Core outage must
 * not answer each one. The notice's message id is chosen up front and marked
 * as already processed, so its echo (Baileys emits our own messages, and
 * self-chat messages are not skipped) never reaches C4 and never loops.
 *
 * @param {object} deps
 * @param {(jid: string, text: string, options: object) => Promise<unknown>} deps.sendText
 * @param {(messageId: string) => void} deps.markOwnMessage - register an id as already handled
 * @param {() => string} deps.generateId - WhatsApp message id generator
 * @param {number} [deps.cooldownMs]
 * @param {() => number} [deps.now]
 * @param {object} [deps.logger]
 * @returns {(opts: { chatJid: string, text: string, quoted?: object }) => Promise<boolean>}
 *   resolves true when a notice was sent
 */
export function createChatNotifier({
  sendText,
  markOwnMessage,
  generateId,
  cooldownMs = NOTICE_COOLDOWN_MS,
  now = Date.now,
  logger = console
}) {
  const sentAt = new Map();
  return async function notifyChat({ chatJid, text, quoted }) {
    const at = now();
    if (at - (sentAt.get(chatJid) ?? -Infinity) < cooldownMs) {
      logger.log(`[whatsapp] Notice to ${chatJid} suppressed (cooldown)`);
      return false;
    }
    for (const [jid, t] of sentAt) if (at - t >= cooldownMs) sentAt.delete(jid);
    sentAt.set(chatJid, at);

    const messageId = generateId();
    markOwnMessage(messageId);
    try {
      await sendText(chatJid, text, { messageId, ...(quoted ? { quoted } : {}) });
      return true;
    } catch (err) {
      logger.error(`[whatsapp] Failed to send notice to ${chatJid}: ${err.message}`);
      return false;
    }
  };
}
