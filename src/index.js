#!/usr/bin/env node
/**
 * zylos-whatsapp - WhatsApp Bot Service
 *
 * Connects to WhatsApp Web via Baileys, receives messages and routes to Claude via C4.
 */

import dotenv from 'dotenv';
import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import QRCode from 'qrcode';

dotenv.config({ path: path.join(process.env.HOME, 'zylos/.env') });

import { getConfig, watchConfig, saveConfig, stopWatching, DATA_DIR } from './lib/config.js';
import { connect, extractText, getMessageType, isGroup, jidToPhone, downloadMedia, getSelfJid, getSelfLid } from './lib/whatsapp.js';

const C4_RECEIVE = path.join(process.env.HOME, 'zylos/.claude/skills/comm-bridge/scripts/c4-receive.js');
const INTERNAL_TOKEN = crypto.randomBytes(24).toString('hex');
const TOKEN_FILE = path.join(DATA_DIR, '.internal-token');
const STATUS_FILE = path.join(DATA_DIR, 'status.json');
const QR_FILE = path.join(DATA_DIR, 'qr.png');

// Persist internal token for send.js
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, INTERNAL_TOKEN, { mode: 0o600 });
} catch (err) {
  console.error(`[whatsapp] Failed to write internal token: ${err.message}`);
}

/**
 * Write connection status to status.json for external monitoring (e.g. provision service).
 */
function writeStatus(state, extra = {}) {
  try {
    const data = { state, updatedAt: new Date().toISOString(), ...extra };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[whatsapp] Failed to write status: ${err.message}`);
  }
}

// Ensure directories
const LOGS_DIR = path.join(DATA_DIR, 'logs');
const MEDIA_DIR = path.join(DATA_DIR, 'media');
fs.mkdirSync(LOGS_DIR, { recursive: true });
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// Message deduplication
const DEDUP_TTL = 5 * 60 * 1000;
const processedMessages = new Map();

function isDuplicate(messageId) {
  if (!messageId) return false;
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now());
  return false;
}

// Periodic cleanup of dedup map
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of processedMessages) {
    if (now - ts > DEDUP_TTL) processedMessages.delete(id);
  }
}, 60000);

// User name cache
const USER_CACHE_PATH = path.join(DATA_DIR, 'user-cache.json');
let userCache = {};
try {
  if (fs.existsSync(USER_CACHE_PATH)) {
    userCache = JSON.parse(fs.readFileSync(USER_CACHE_PATH, 'utf8'));
  }
} catch { /* ignore */ }

function cacheUserName(jid, name) {
  if (jid && name) {
    userCache[jid] = name;
    try {
      fs.writeFileSync(USER_CACHE_PATH, JSON.stringify(userCache, null, 2));
    } catch { /* ignore */ }
  }
}

function sanitizeFileName(name) {
  return path.basename(String(name || 'file')).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
}

/**
 * Send message to C4 bridge
 */
function sendToC4(channel, endpoint, content) {
  return new Promise((resolve, reject) => {
    execFile('node', [C4_RECEIVE, '--channel', channel, '--endpoint', endpoint, '--content', content], {
      timeout: 30000
    }, (err, stdout, stderr) => {
      if (err) {
        console.error(`[whatsapp] C4 receive error: ${err.message}`);
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Check access control for a message
 */
function checkAccess(config, senderJid, chatJid, isGroupMsg) {
  const senderPhone = jidToPhone(senderJid);
  const ownerJid = config.owner?.jid;

  // Self-chat ("Message Yourself") is always allowed — it's the account owner by definition
  const selfLid = getSelfLid();
  const selfLidNum = selfLid ? String(selfLid).split(':')[0].split('@')[0] : null;
  const senderNum = String(senderJid).split(':')[0].split('@')[0];
  const chatNum = String(chatJid).split(':')[0].split('@')[0];
  if (selfLidNum && (selfLidNum === senderNum || selfLidNum === chatNum)) {
    return true;
  }

  // Owner always allowed
  if (ownerJid && senderNum === String(ownerJid).split(':')[0].split('@')[0]) {
    return true;
  }

  if (isGroupMsg) {
    switch (config.groupPolicy) {
      case 'disabled': return false;
      case 'open': return true;
      case 'allowlist': {
        const group = config.groups?.[chatJid];
        if (!group) return false;
        if (group.allowFrom?.length > 0) {
          return group.allowFrom.includes(senderPhone);
        }
        return true;
      }
      default: return false;
    }
  } else {
    switch (config.dmPolicy) {
      case 'open': return true;
      case 'allowlist': return config.dmAllowFrom?.includes(senderPhone);
      case 'owner': return false;
      default: return false;
    }
  }
}

/**
 * Handle incoming message
 */
async function handleMessage(msg) {
  const messageId = msg.key.id;
  if (isDuplicate(messageId)) return;

  const config = getConfig();
  if (!config.enabled) return;

  const chatJid = msg.key.remoteJid;
  const isGroupMsg = isGroup(chatJid);
  const senderJid = isGroupMsg ? msg.key.participant : chatJid;

  // Self-message check: allow self-chat ("Message Yourself") but skip echoes in other chats
  const selfJid = getSelfJid();
  const selfLid = getSelfLid();
  if (selfJid && senderJid) {
    const selfNum = String(selfJid).split(':')[0].split('@')[0];
    const selfLidNum = selfLid ? String(selfLid).split(':')[0].split('@')[0] : null;
    const senderNum = String(senderJid).split(':')[0].split('@')[0];
    const chatNum = String(chatJid).split(':')[0].split('@')[0];
    const isSelfChat = (selfNum === chatNum) || (selfLidNum && selfLidNum === chatNum);
    const isSelf = (selfNum === senderNum) || (selfLidNum && selfLidNum === senderNum);
    if (isSelf && !isSelfChat) return;
  }

  // Owner auto-bind (first DM)
  if (!config.owner?.bound && !isGroupMsg) {
    const phone = jidToPhone(senderJid);
    config.owner = {
      bound: true,
      jid: senderJid,
      name: msg.pushName || phone
    };
    saveConfig(config);
    console.log(`[whatsapp] Owner bound: ${config.owner.name} (${phone})`);
  }

  // Access control
  if (!checkAccess(config, senderJid, chatJid, isGroupMsg)) {
    console.log(`[whatsapp] Access denied for ${jidToPhone(senderJid)} in ${chatJid}`);
    return;
  }

  // Extract content
  const msgType = getMessageType(msg);
  let textContent = extractText(msg) || '';
  let filePaths = [];

  // Handle media
  if (['image', 'video', 'audio', 'document'].includes(msgType)) {
    try {
      const buffer = await downloadMedia(msg);
      const ext = {
        image: '.png', video: '.mp4', audio: '.ogg', document: ''
      }[msgType];
      const docName = msg.message?.documentMessage?.fileName;
      const fileName = docName ? sanitizeFileName(docName) : `${msgType}-${Date.now()}${ext}`;
      const filePath = path.join(MEDIA_DIR, fileName);
      fs.writeFileSync(filePath, buffer);
      filePaths.push(filePath);
      console.log(`[whatsapp] Media saved: ${filePath}`);
    } catch (err) {
      console.error(`[whatsapp] Failed to download media: ${err.message}`);
      textContent = textContent || `[${msgType} - download failed]`;
    }
  }

  if (!textContent && filePaths.length === 0) {
    if (msgType === 'sticker') return; // skip stickers silently
    return; // skip unknown types
  }

  // Get sender name
  const senderName = msg.pushName || userCache[senderJid] || jidToPhone(senderJid);
  if (msg.pushName) cacheUserName(senderJid, msg.pushName);

  // Format for C4
  let channelPrefix;
  let endpoint;

  if (isGroupMsg) {
    const groupName = config.groups?.[chatJid]?.name || chatJid;
    channelPrefix = `[WhatsApp GROUP:${groupName}]`;
    endpoint = `${chatJid}|type:group|msg:${messageId}`;
  } else {
    channelPrefix = `[WhatsApp DM]`;
    endpoint = `${chatJid}|type:p2p|msg:${messageId}`;
  }

  let c4Content = `${channelPrefix} ${senderName} said: ${textContent}`;

  // Append file paths
  if (filePaths.length > 0) {
    c4Content += filePaths.map(fp => `\n[file: ${fp}]`).join('');
  }

  // Log message
  const logFile = path.join(LOGS_DIR, `${chatJid.replace(/[^a-zA-Z0-9@.-]/g, '_')}.log`);
  const logLine = `[${new Date().toISOString()}] ${senderName}: ${textContent}\n`;
  try {
    fs.appendFileSync(logFile, logLine);
  } catch { /* ignore */ }

  // Send to C4
  const replyVia = `node /home/owen/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "whatsapp" "${endpoint}"`;
  const fullContent = `${c4Content} ---- reply via: ${replyVia}`;

  try {
    await sendToC4('whatsapp', endpoint, fullContent);
    console.log(`[whatsapp] Message from ${senderName} forwarded to C4`);
  } catch (err) {
    console.error(`[whatsapp] Failed to forward to C4: ${err.message}`);
  }
}

// ============================================================
// Main startup
// ============================================================
console.log(`[whatsapp] Starting...`);
console.log(`[whatsapp] Data directory: ${DATA_DIR}`);

const config = getConfig();

// Watch config changes
watchConfig((newConfig) => {
  console.log('[whatsapp] Config reloaded');
});

// Connect to WhatsApp
writeStatus('connecting');
connect({
  onMessage: handleMessage,
  onQr: async (qr) => {
    try {
      await QRCode.toFile(QR_FILE, qr, { width: 512 });
      writeStatus('qr_waiting');
      console.log(`[whatsapp] QR code saved to ${QR_FILE}. Scan with your phone to login.`);
    } catch (err) {
      console.error(`[whatsapp] Failed to save QR: ${err.message}`);
    }
  },
  onConnected: (user) => {
    const phoneNumber = user?.id ? '+' + String(user.id).split(':')[0].split('@')[0] : undefined;
    writeStatus('open', { phoneNumber });
    // Remove stale QR file
    try { fs.unlinkSync(QR_FILE); } catch { /* ignore */ }
    console.log(`[whatsapp] Successfully connected as ${user?.id}`);
  },
  onDisconnected: (statusCode) => {
    writeStatus('disconnected', { statusCode });
    console.log(`[whatsapp] Disconnected (status: ${statusCode})`);
  }
}).catch(err => {
  writeStatus('disconnected', { error: err.message });
  console.error(`[whatsapp] Fatal connection error: ${err.message}`);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('[whatsapp] Shutting down...');
  stopWatching();
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log('[whatsapp] Shutting down...');
  stopWatching();
  process.exit(0);
});
