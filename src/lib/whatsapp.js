/**
 * WhatsApp Web connection via Baileys
 *
 * Handles: QR auth, persistent sessions, message send/receive.
 */

import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from 'baileys';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'https';
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

const WA_WEB_SW_URL = 'https://web.whatsapp.com/sw.js';
const VERSION_FETCH_TIMEOUT_MS = 15000;

/**
 * Fetch web.whatsapp.com/sw.js through the SAME proxy agent the socket uses
 * (Baileys' fetchLatestWaWebVersion() does a bare global fetch, which bypasses
 * cfg.proxy / WHATSAPP_PROXY and has no timeout — on proxy-required
 * deployments it would hang or fail while the direct path is blocked).
 *
 * @param {import('http').Agent} [agent] - proxy agent, or undefined for direct
 * @returns {Promise<string>} sw.js body
 */
async function fetchSwJs(agent) {
  let req;
  const attempt = new Promise((resolve, reject) => {
    req = https.get(WA_WEB_SW_URL, {
      agent,
      headers: {
        // Minimal headers Baileys' own helper sends to bypass anti-bot detection
        'sec-fetch-site': 'none',
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} fetching ${WA_WEB_SW_URL}`));
        req.destroy();
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
  });
  // If the timeout wins the race, the attempt may still settle later — keep
  // its rejection handled so it cannot crash the process.
  attempt.catch(() => {});
  // Wall-clock timeout as a racing promise: while a proxy agent is still
  // awaiting its CONNECT, the request has no socket, so neither AbortSignal
  // nor req.destroy() produces an 'error' event — a request-side timeout
  // would never fire.
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      req.destroy();
      reject(new Error(`timed out after ${VERSION_FETCH_TIMEOUT_MS}ms fetching ${WA_WEB_SW_URL}`));
    }, VERSION_FETCH_TIMEOUT_MS);
  });
  try {
    return await Promise.race([attempt, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the WA Web version to advertise to WhatsApp servers.
 *
 * Fetches the current version from web.whatsapp.com through the given proxy
 * agent (same egress as the socket), with an explicit timeout. Behavior on
 * fetch failure depends on whether pairing/registration has completed
 * (creds.registered === true, or creds.account which is written only at
 * pair-success — a real QR pairing leaves registered=false; creds.me alone is
 * not proof, as it is set during the pairing-code phase before completion):
 * - registration not completed (required=true): throw — pairing with the stale
 *   Baileys bundled version is a known 405/408 failure class, so refuse to
 *   attempt it and surface an actionable error instead.
 * - completed registration (required=false): return undefined so Baileys
 *   resumes the session with its bundled default — allowed degradation,
 *   logged loudly.
 *
 * @param {Object} opts
 * @param {import('http').Agent} [opts.agent] - proxy agent, or undefined for direct
 * @param {boolean} opts.required - true when pairing/registration has not completed (no creds.registered and no creds.account)
 * @returns {Promise<number[]|undefined>} WA Web version tuple, e.g. [2, 3000, 1043113828]
 */
async function resolveWaWebVersion({ agent, required }) {
  try {
    const body = await fetchSwJs(agent);
    // Same extraction as Baileys' fetchLatestWaWebVersion()
    const match = body.match(/\\?"client_revision\\?":\s*(\d+)/);
    if (!match?.[1]) {
      throw new Error('could not find client_revision in sw.js');
    }
    const version = [2, 3000, Number(match[1])];
    console.log(
      `[whatsapp] Using WA Web version ${version.join('.')} ` +
      `(fetched from web.whatsapp.com${agent ? ' via proxy' : ''})`
    );
    return version;
  } catch (err) {
    if (required) {
      throw new Error(
        `cannot determine the current WA Web version (${err.message}) and no completed ` +
        `registration exists. Refusing to attempt fresh QR pairing with the stale Baileys ` +
        `bundled version — WhatsApp rejects registrations from stale clients (405/408). ` +
        `Check network egress and proxy settings (config "proxy" / WHATSAPP_PROXY), then restart.`
      );
    }
    console.error(
      `[whatsapp] Failed to fetch latest WA Web version: ${err.message}; ` +
      `resuming the existing registered session with the Baileys bundled default, ` +
      `which may be stale (fresh pairing would be refused in this state)`
    );
    return undefined;
  }
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

  // Resolve the proxy BEFORE anything touches the network, so the version
  // fetch and the socket share the same egress path (datacenter IPs may be
  // blocked from direct access and require the proxy).
  const cfg = getConfig();
  const proxyUrl = cfg.proxy || process.env.WHATSAPP_PROXY;
  let agent;
  if (proxyUrl) {
    const isSocks = proxyUrl.startsWith('socks');
    agent = isSocks ? new SocksProxyAgent(proxyUrl) : new HttpsProxyAgent(proxyUrl);
    console.log(`[whatsapp] Using ${isSocks ? 'SOCKS' : 'HTTP'} proxy: ${proxyUrl.replace(/\/\/.*@/, '//***@')}`);
  }

  // Fetch the authoritative WA Web version and pass it to the socket. Do not
  // pin an old version and do not rely on the Baileys bundled default: WhatsApp
  // rejects new registrations/pairings from stale client builds (405/408, see
  // WhiskeySockets/Baileys#2679). For fresh auth this is a hard requirement —
  // resolveWaWebVersion() throws instead of degrading to the bundled default.
  // QR codes are handled via the connection.update event (printQRInTerminal is
  // deprecated in Baileys 7.x).
  // Pairing-completion proof: creds.registered === true (pairing-code flow)
  // OR creds.account present (ADVSignedDeviceIdentity, written only by
  // configureSuccessfulPairing at pair-success — verified empirically: a real
  // QR pairing leaves registered=false and sets account). creds.me alone is
  // NOT proof: Baileys sets it during the requestPairingCode phase
  // (Socket/socket.js), BEFORE pairing finishes — treating me.id as proof
  // would let a half-paired session degrade to the stale bundled version and
  // hit the 405/408 fresh-pairing failure class.
  const registrationComplete = state.creds?.registered === true || !!state.creds?.account;
  let waVersion;
  try {
    waVersion = await resolveWaWebVersion({ agent, required: !registrationComplete });
  } catch (err) {
    connectionState = 'disconnected';
    throw err;
  }

  const socketOpts = { auth: state };
  // Only set the key when resolved: makeWASocket spreads the config over its
  // defaults, so an explicit `version: undefined` would clobber the bundled
  // default instead of falling back to it.
  if (waVersion) socketOpts.version = waVersion;
  if (agent) {
    socketOpts.agent = agent;
    socketOpts.fetchAgent = agent;
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
          connect({ onMessage, onQr, onConnected, onDisconnected }).catch((err) => {
            // Same contract as the initial connect() failure in index.js:
            // surface the error and exit so the process manager restarts us —
            // the startup path then reports the error in status.json.
            console.error(`[whatsapp] Fatal reconnection error: ${err.message}`);
            process.exit(1);
          });
        }, 5000);
      } else {
        // Baileys' own DisconnectReason.loggedOut is a definitive signal from
        // WhatsApp that this session is dead — there is nothing left to
        // preserve. Left in place, the next connect() (triggered by a pm2
        // restart from a user-initiated reconnect) would call
        // useMultiFileAuthState on these same revoked credentials and attempt
        // session RESUMPTION instead of fresh pairing, hitting the identical
        // loggedOut failure again — the process never reaches a state that
        // emits a QR code, so "reconnect" silently does nothing forever.
        console.log('[whatsapp] Logged out. Clearing auth_info and starting a fresh QR pairing.');
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch (err) {
          console.error(`[whatsapp] Failed to clear auth_info after logout: ${err.message}`);
        }
        // Reconnect immediately (auth_info is now empty, so this is a fresh
        // pairing, not the resumption attempt that just failed) instead of
        // waiting for an external pm2 restart to trigger the next attempt —
        // the customer's "Connect" click already asked for a new QR; no need
        // to make them wait through another full connector-dispatch round trip.
        setTimeout(() => {
          console.log('[whatsapp] Starting fresh pairing after logout...');
          connect({ onMessage, onQr, onConnected, onDisconnected }).catch((err) => {
            console.error(`[whatsapp] Fatal reconnection error: ${err.message}`);
            process.exit(1);
          });
        }, 5000);
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
