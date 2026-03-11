/**
 * WhatsApp Web connection via Baileys
 *
 * Handles: QR auth, persistent sessions, message send/receive.
 */

import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from 'baileys';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import path from 'path';
import fs from 'fs';
import { DATA_DIR, getConfig } from './config.js';

const AUTH_DIR = path.join(DATA_DIR, 'auth_info');

let sock = null;
let connectionState = 'disconnected'; // disconnected | connecting | open

/**
 * Get the current socket instance
 */
export function getSocket() {
  return sock;
}

/**
 * Get connection state
 */
export function getConnectionState() {
  return connectionState;
}

/**
 * Get self JID (the bot's own WhatsApp ID)
 */
export function getSelfJid() {
  return sock?.user?.id || null;
}

/**
 * Get self LID (Linked Identity)
 */
export function getSelfLid() {
  return sock?.user?.lid || null;
}

/**
 * Connect to WhatsApp Web
 * @param {Object} options
 * @param {Function} options.onMessage - Callback for incoming messages
 * @param {Function} options.onQr - Callback when QR code is generated
 * @param {Function} options.onConnected - Callback when connected
 * @param {Function} options.onDisconnected - Callback when disconnected
 */
export async function connect({ onMessage, onQr, onConnected, onDisconnected }) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  connectionState = 'connecting';

  // Override Baileys hardcoded version to avoid 405 protocol mismatch
  const WA_VERSION = [2, 3000, 1034074495];
  const socketOpts = { auth: state, printQRInTerminal: true, version: WA_VERSION };

  // Use SOCKS5 proxy if configured (to bypass datacenter IP blocking)
  const cfg = getConfig();
  const proxyUrl = cfg.proxy || process.env.WHATSAPP_PROXY;
  if (proxyUrl) {
    const isSocks = proxyUrl.startsWith('socks');
    const agent = isSocks ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
    socketOpts.agent = agent;
    socketOpts.fetchAgent = agent;
    console.log(`[whatsapp] Using ${isSocks ? 'SOCKS' : 'HTTP'} proxy: ${proxyUrl.replace(/\/\/.*@/, '//***@')}`);
  }

  sock = makeWASocket(socketOpts);

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && onQr) {
      onQr(qr);
    }

    if (connection === 'close') {
      connectionState = 'disconnected';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      console.log(`[whatsapp] Connection closed. Status: ${statusCode}. Reconnect: ${shouldReconnect}`);

      if (onDisconnected) onDisconnected(statusCode);

      if (shouldReconnect) {
        setTimeout(() => {
          console.log('[whatsapp] Reconnecting...');
          connect({ onMessage, onQr, onConnected, onDisconnected });
        }, 5000);
      } else {
        console.log('[whatsapp] Logged out. Delete auth_info to re-auth.');
      }
    } else if (connection === 'open') {
      connectionState = 'open';
      console.log(`[whatsapp] Connected as ${sock.user?.id}`);
      if (onConnected) onConnected(sock.user);
    }
  });

  sock.ev.on('messages.upsert', async (event) => {
    if (!onMessage) return;
    for (const msg of event.messages) {
      // Skip status broadcasts
      if (msg.key.remoteJid === 'status@broadcast') continue;
      // Skip messages sent by us (except self-chat / "Message Yourself")
      const selfId = sock?.user?.id;
      const selfNum = selfId ? String(selfId).split(':')[0].split('@')[0] : null;
      const selfLid = sock?.user?.lid;
      const selfLidNum = selfLid ? String(selfLid).split(':')[0].split('@')[0] : null;
      const remoteNum = msg.key.remoteJid ? String(msg.key.remoteJid).split(':')[0].split('@')[0] : null;
      const isSelfChat = (selfNum && remoteNum && selfNum === remoteNum) ||
                         (selfLidNum && remoteNum && selfLidNum === remoteNum);
      if (msg.key.fromMe && !isSelfChat) continue;
      // Skip protocol messages (reactions, receipts, etc.)
      if (!msg.message) continue;

      try {
        await onMessage(msg);
      } catch (err) {
        console.error(`[whatsapp] Error handling message: ${err.message}`);
      }
    }
  });

  return sock;
}

/**
 * Send a text message
 * @param {string} jid - Target JID
 * @param {string} text - Message text
 * @param {Object} [options] - Additional options
 * @param {Object} [options.quoted] - Message to quote/reply to
 */
export async function sendText(jid, text, options = {}) {
  if (!sock) throw new Error('Not connected');
  return sock.sendMessage(jid, { text }, options);
}

/**
 * Send an image
 * @param {string} jid - Target JID
 * @param {string} imagePath - Path to image file
 * @param {string} [caption] - Optional caption
 * @param {Object} [options] - Additional options
 */
export async function sendImage(jid, imagePath, caption, options = {}) {
  if (!sock) throw new Error('Not connected');
  return sock.sendMessage(jid, {
    image: { url: imagePath },
    caption: caption || undefined
  }, options);
}

/**
 * Send a file/document
 * @param {string} jid - Target JID
 * @param {string} filePath - Path to file
 * @param {string} [filename] - Display filename
 * @param {Object} [options] - Additional options
 */
export async function sendDocument(jid, filePath, filename, options = {}) {
  if (!sock) throw new Error('Not connected');
  const mime = 'application/octet-stream';
  return sock.sendMessage(jid, {
    document: { url: filePath },
    mimetype: mime,
    fileName: filename || path.basename(filePath)
  }, options);
}

/**
 * Download media from a message
 * @param {Object} msg - Baileys message object
 * @returns {Buffer} Downloaded media buffer
 */
export async function downloadMedia(msg) {
  return downloadMediaMessage(msg, 'buffer', {});
}

/**
 * Extract text content from a message
 * @param {Object} msg - Baileys message object
 * @returns {string|null} Text content
 */
export function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || m.videoMessage?.caption
    || m.documentMessage?.caption
    || null;
}

/**
 * Get the message type
 * @param {Object} msg - Baileys message object
 * @returns {string} Message type: text, image, video, audio, document, sticker, other
 */
export function getMessageType(msg) {
  const m = msg.message;
  if (!m) return 'other';
  if (m.conversation || m.extendedTextMessage) return 'text';
  if (m.imageMessage) return 'image';
  if (m.videoMessage) return 'video';
  if (m.audioMessage) return 'audio';
  if (m.documentMessage) return 'document';
  if (m.stickerMessage) return 'sticker';
  return 'other';
}

/**
 * Check if JID is a group
 * @param {string} jid
 * @returns {boolean}
 */
export function isGroup(jid) {
  return jid?.endsWith('@g.us') || false;
}

/**
 * Extract phone number from JID
 * @param {string} jid - e.g. "8613800138000@s.whatsapp.net"
 * @returns {string} Phone number with + prefix
 */
export function jidToPhone(jid) {
  if (!jid) return '';
  const num = jid.split('@')[0].split(':')[0];
  return '+' + num;
}

/**
 * Convert phone number to JID
 * @param {string} phone - e.g. "+8613800138000" or "8613800138000"
 * @returns {string} JID
 */
export function phoneToJid(phone) {
  const num = phone.replace(/[^0-9]/g, '');
  return num + '@s.whatsapp.net';
}

/**
 * Disconnect from WhatsApp
 */
export async function disconnect() {
  if (sock) {
    sock.end(undefined);
    sock = null;
    connectionState = 'disconnected';
  }
}
