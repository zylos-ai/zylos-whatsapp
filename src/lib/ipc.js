/**
 * Local IPC between the resident WhatsApp service and short-lived CLI processes.
 *
 * Why this exists: WhatsApp Web permits a single active session per device
 * registration. `scripts/send.js` used to open its own Baileys connection from
 * the same auth files on every outbound message, and WhatsApp answers a second
 * registration by sending `stream:error / conflict: type=replaced` to the
 * connection that already exists — kicking the resident listener offline and
 * dropping inbound messages until it reconnects (~4s). Outbound must therefore
 * be handed to the process that already holds the session rather than racing it.
 *
 * Transport: Unix domain socket under DATA_DIR, newline-delimited JSON, one
 * request/response per connection. Requests carry the same internal token the
 * service already persists (mode 0600), so another local user cannot use the
 * socket to send messages even if the filesystem permissions were widened.
 */

import fs from 'fs';
import net from 'net';
import path from 'path';
import { DATA_DIR } from './config.js';

export const SOCKET_PATH = path.join(DATA_DIR, 'send.sock');
export const TOKEN_FILE = path.join(DATA_DIR, '.internal-token');

/** Default budget for a send round-trip; a WhatsApp send can take a few seconds. */
export const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Thrown when the resident service is not reachable (socket missing, stale, or
 * refusing connections). Callers should treat this as "fall back to connecting
 * inline", not as a send failure.
 */
export class IpcUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IpcUnavailableError';
    this.code = 'IPC_UNAVAILABLE';
  }
}

function readToken() {
  try {
    return fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    return null;
  }
}

/**
 * Start the send server. Call once the WhatsApp connection is open.
 *
 * @param {object} options
 * @param {(payload: object) => Promise<object>} options.onRequest Handles a
 *   validated request and resolves with the response body (without `ok`).
 * @param {(msg: string) => void} [options.log]
 * @returns {{ close: () => void, socketPath: string }}
 */
export function startSendServer({ onRequest, log = () => {} }) {
  // A socket file left behind by a crashed process would make bind() fail with
  // EADDRINUSE even though nobody is listening, so clear it first. This is safe:
  // a live server holds the inode, and a second service instance is prevented by
  // PM2, not by this file.
  try {
    fs.unlinkSync(SOCKET_PATH);
  } catch (err) {
    if (err.code !== 'ENOENT') log(`[whatsapp] Could not remove stale socket: ${err.message}`);
  }

  const expectedToken = readToken();

  const server = net.createServer((conn) => {
    conn.setEncoding('utf8');
    let buffer = '';
    let handled = false;

    const reply = (body) => {
      if (handled) return;
      handled = true;
      try {
        conn.end(JSON.stringify(body) + '\n');
      } catch {
        /* client vanished */
      }
    };

    conn.on('data', async (chunk) => {
      buffer += chunk;
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx < 0) {
        // Guard against an unbounded client; a legitimate request is small.
        if (buffer.length > 1_000_000) reply({ ok: false, error: 'request too large' });
        return;
      }

      let payload;
      try {
        payload = JSON.parse(buffer.slice(0, newlineIdx));
      } catch (err) {
        reply({ ok: false, error: `invalid JSON: ${err.message}` });
        return;
      }

      if (expectedToken && payload?.token !== expectedToken) {
        reply({ ok: false, error: 'unauthorized' });
        return;
      }

      try {
        const result = await onRequest(payload);
        reply({ ok: true, ...result });
      } catch (err) {
        reply({ ok: false, error: err?.message || String(err) });
      }
    });

    conn.on('error', () => { /* client disconnects are not service errors */ });
  });

  server.on('error', (err) => {
    log(`[whatsapp] Send socket error: ${err.message}`);
  });

  server.listen(SOCKET_PATH, () => {
    // Owner-only: the socket is the authority to send as this account.
    try {
      fs.chmodSync(SOCKET_PATH, 0o600);
    } catch (err) {
      log(`[whatsapp] Could not chmod send socket: ${err.message}`);
    }
    log(`[whatsapp] Send socket listening at ${SOCKET_PATH}`);
  });

  return {
    socketPath: SOCKET_PATH,
    close() {
      try {
        server.close();
      } catch { /* already closed */ }
      try {
        fs.unlinkSync(SOCKET_PATH);
      } catch { /* already gone */ }
    },
  };
}

/**
 * Build the request handler the resident service passes to startSendServer.
 *
 * Kept here (with the senders injected) so the request contract can be tested
 * without importing src/index.js, which connects to WhatsApp on import.
 *
 * @param {{ sendText: Function, sendImage: Function, sendDocument: Function }} senders
 * @returns {(payload: object) => Promise<object>}
 */
export function createSendHandler({ sendText, sendImage, sendDocument }) {
  return async function handleSendRequest(payload) {
    const { kind, chatId } = payload || {};
    if (!chatId) throw new Error('chatId is required');
    switch (kind) {
      case 'text': {
        if (typeof payload.text !== 'string' || payload.text === '') {
          throw new Error('text is required');
        }
        await sendText(chatId, payload.text);
        return { kind: 'text' };
      }
      case 'image':
        if (!payload.path) throw new Error('path is required');
        await sendImage(chatId, payload.path);
        return { kind: 'image' };
      case 'file':
        if (!payload.path) throw new Error('path is required');
        await sendDocument(chatId, payload.path);
        return { kind: 'file' };
      default:
        throw new Error(`unsupported kind: ${kind}`);
    }
  };
}

/**
 * Ask the resident service to perform a send.
 *
 * @param {object} payload `{ kind: 'text'|'image'|'file', chatId, text?, path? }`
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<object>} the service's response body
 * @throws {IpcUnavailableError} when the service is not reachable
 * @throws {Error} when the service replied with a failure
 */
export function requestSend(payload, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SOCKET_PATH)) {
      reject(new IpcUnavailableError('resident service not listening (no send socket)'));
      return;
    }

    const conn = net.createConnection(SOCKET_PATH);
    conn.setEncoding('utf8');
    let buffer = '';
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { conn.destroy(); } catch { /* ignore */ }
      fn(arg);
    };

    const timer = setTimeout(() => {
      // The service is listening but did not answer in time: a real failure,
      // not an "unavailable" — retrying inline would open the conflicting
      // session this whole mechanism exists to avoid.
      finish(reject, new Error(`timed out after ${timeoutMs}ms waiting for the resident service`));
    }, timeoutMs);

    conn.on('connect', () => {
      conn.write(JSON.stringify({ token: readToken(), ...payload }) + '\n');
    });

    conn.on('data', (chunk) => {
      buffer += chunk;
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx < 0) return;
      let body;
      try {
        body = JSON.parse(buffer.slice(0, newlineIdx));
      } catch (err) {
        finish(reject, new Error(`invalid response from service: ${err.message}`));
        return;
      }
      if (body?.ok) finish(resolve, body);
      else finish(reject, new Error(body?.error || 'send rejected by service'));
    });

    conn.on('error', (err) => {
      // ENOENT/ECONNREFUSED mean the socket file is stale (service down or
      // restarting) — that is the fall-back-to-inline case.
      if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
        finish(reject, new IpcUnavailableError(`resident service not reachable (${err.code})`));
      } else {
        finish(reject, err);
      }
    });

    conn.on('close', () => {
      if (!settled) finish(reject, new IpcUnavailableError('connection closed before a response'));
    });
  });
}
