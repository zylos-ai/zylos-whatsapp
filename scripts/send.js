#!/usr/bin/env node
/**
 * C4 Communication Bridge Interface for zylos-whatsapp
 *
 * Usage:
 *   ./send.js <endpoint_id> "message text"
 *   ./send.js <endpoint_id> "[MEDIA:image]/path/to/image.png"
 *   ./send.js <endpoint_id> "[MEDIA:file]/path/to/document.pdf"
 *
 * Exit codes:
 *   0 - Success
 *   1 - Error
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(process.env.HOME, 'zylos/.env') });

import { getConfig } from '../src/lib/config.js';
import { sendText, sendImage, sendDocument } from '../src/lib/whatsapp.js';

const MAX_LENGTH = 4000;

// Parse arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.error('Usage: send.js <endpoint_id> <message>');
  process.exit(1);
}

const rawEndpoint = args[0];
const message = args.slice(1).join(' ');

// Parse endpoint: chatId|type:group|msg:messageId
const ENDPOINT_KEYS = new Set(['type', 'root', 'parent', 'msg', 'thread']);

function parseEndpoint(endpoint) {
  const parts = endpoint.split('|');
  const result = { chatId: parts[0] };
  for (const part of parts.slice(1)) {
    const colonIdx = part.indexOf(':');
    if (colonIdx > 0) {
      const key = part.substring(0, colonIdx);
      if (!ENDPOINT_KEYS.has(key)) continue;
      result[key] = part.substring(colonIdx + 1);
    }
  }
  return result;
}

// Check for media prefix
function parseMedia(text) {
  const imageMatch = text.match(/^\[MEDIA:image\](.+)$/);
  if (imageMatch) return { type: 'image', path: imageMatch[1].trim() };
  const fileMatch = text.match(/^\[MEDIA:file\](.+)$/);
  if (fileMatch) return { type: 'file', path: fileMatch[1].trim() };
  return null;
}

// Split long messages at natural boundaries
function chunkMessage(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = maxLen;
    // Try to split at paragraph
    const paraIdx = remaining.lastIndexOf('\n\n', maxLen);
    if (paraIdx > maxLen * 0.3) {
      splitAt = paraIdx + 2;
    } else {
      // Try to split at line
      const lineIdx = remaining.lastIndexOf('\n', maxLen);
      if (lineIdx > maxLen * 0.3) {
        splitAt = lineIdx + 1;
      }
    }
    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function main() {
  const config = getConfig();
  if (!config.enabled) {
    console.error('[whatsapp] Component disabled');
    process.exit(1);
  }

  const { chatId } = parseEndpoint(rawEndpoint);
  const media = parseMedia(message);

  try {
    // Need to connect first — import and initialize
    const { connect, getConnectionState } = await import('../src/lib/whatsapp.js');

    // Wait for connection (send.js is a short-lived process, so we connect inline)
    if (getConnectionState() !== 'open') {
      await connect({});
      // Wait up to 15s for connection
      for (let i = 0; i < 30; i++) {
        if (getConnectionState() === 'open') break;
        await new Promise(r => setTimeout(r, 500));
      }
      if (getConnectionState() !== 'open') {
        console.error('[whatsapp] Failed to connect');
        process.exit(1);
      }
    }

    if (media) {
      if (media.type === 'image') {
        await sendImage(chatId, media.path);
      } else {
        await sendDocument(chatId, media.path);
      }
      console.log(`[whatsapp] Media sent to ${chatId}`);
    } else {
      const chunks = chunkMessage(message, MAX_LENGTH);
      for (const chunk of chunks) {
        await sendText(chatId, chunk);
        if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
      }
      console.log(`[whatsapp] Text sent to ${chatId} (${chunks.length} chunk(s))`);
    }

    process.exit(0);
  } catch (err) {
    console.error(`[whatsapp] Send failed: ${err.message}`);
    process.exit(1);
  }
}

main();
