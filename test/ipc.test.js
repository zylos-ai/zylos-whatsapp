/**
 * Tests for the local send IPC.
 *
 * Isolation note: src/lib/config.js derives DATA_DIR from process.env.HOME at
 * import time, so HOME is pointed at a temp directory *before* importing the
 * module under test. That keeps the suite from touching (or unlinking the socket
 * of) a live service's data directory.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'zylos-whatsapp-ipc-'));
process.env.HOME = tmpHome;
const dataDir = path.join(tmpHome, 'zylos/components/whatsapp');
fs.mkdirSync(dataDir, { recursive: true });

const TOKEN = 'test-token-0123456789';
fs.writeFileSync(path.join(dataDir, '.internal-token'), TOKEN, { mode: 0o600 });

const { startSendServer, requestSend, createSendHandler, IpcUnavailableError, SOCKET_PATH } =
  await import('../src/lib/ipc.js');

describe('send IPC', () => {
  it('reports unavailable when no service is listening', async () => {
    await assert.rejects(
      () => requestSend({ kind: 'text', chatId: 'x@s.whatsapp.net', text: 'hi' }),
      (err) => err instanceof IpcUnavailableError,
      'a missing socket must surface as IpcUnavailableError so send.js falls back inline'
    );
  });

  describe('with a running server', () => {
    let server;
    const seen = [];

    before(() => {
      // The real handler, with the Baileys senders stubbed — so these tests
      // cover the actual request contract the service serves, not a look-alike.
      const handler = createSendHandler({
        sendText: async (chatId, text) => {
          if (text === 'boom') throw new Error('provider rejected the message');
          seen.push({ kind: 'text', chatId, text });
        },
        sendImage: async (chatId, p) => seen.push({ kind: 'image', chatId, path: p }),
        sendDocument: async (chatId, p) => seen.push({ kind: 'file', chatId, path: p }),
      });
      server = startSendServer({ onRequest: handler });
      // listen() is async; wait for the socket file to appear.
      return new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const tick = () => {
          if (fs.existsSync(SOCKET_PATH)) return resolve();
          if (Date.now() > deadline) return reject(new Error('socket did not appear'));
          setTimeout(tick, 25);
        };
        tick();
      });
    });

    after(() => server.close());

    it('delivers a text send to the resident handler', async () => {
      const res = await requestSend({ kind: 'text', chatId: 'a@s.whatsapp.net', text: 'hello' });
      assert.equal(res.ok, true);
      assert.equal(res.kind, 'text');
      const last = seen.at(-1);
      assert.equal(last.chatId, 'a@s.whatsapp.net');
      assert.equal(last.text, 'hello');
    });

    it('delivers media sends with their path', async () => {
      await requestSend({ kind: 'image', chatId: 'b@s.whatsapp.net', path: '/tmp/x.png' });
      const last = seen.at(-1);
      assert.equal(last.kind, 'image');
      assert.equal(last.path, '/tmp/x.png');
    });

    it('creates the socket owner-only', () => {
      const mode = fs.statSync(SOCKET_PATH).mode & 0o777;
      assert.equal(mode, 0o600, `socket mode should be 0600, got ${mode.toString(8)}`);
    });

    it('surfaces a handler failure as a real error, not as unavailable', async () => {
      // send.js must NOT retry inline in this case: the service is alive, so a
      // second Baileys connection would create the very session conflict the
      // IPC path exists to prevent.
      await assert.rejects(
        () => requestSend({ kind: 'text', chatId: 'c@s.whatsapp.net', text: 'boom' }),
        (err) => err instanceof Error
          && !(err instanceof IpcUnavailableError)
          && /provider rejected the message/.test(err.message)
      );
    });

    it('rejects a request with no chatId', async () => {
      await assert.rejects(
        () => requestSend({ kind: 'text', text: 'hi' }),
        (err) => !(err instanceof IpcUnavailableError) && /chatId is required/.test(err.message)
      );
    });

    it('rejects an empty text body', async () => {
      await assert.rejects(
        () => requestSend({ kind: 'text', chatId: 'f@s.whatsapp.net', text: '' }),
        (err) => !(err instanceof IpcUnavailableError) && /text is required/.test(err.message)
      );
    });

    it('rejects an unsupported kind', async () => {
      await assert.rejects(
        () => requestSend({ kind: 'carrier-pigeon', chatId: 'd@s.whatsapp.net' }),
        (err) => !(err instanceof IpcUnavailableError)
      );
    });
  });

  it('replaces a stale socket file left by a crashed service', async () => {
    // A crashed process leaves the socket file behind; bind() would fail with
    // EADDRINUSE if it were not cleared, leaving sends permanently inline.
    fs.writeFileSync(SOCKET_PATH, '');
    const server = startSendServer({
      onRequest: createSendHandler({ sendText: async () => {}, sendImage: async () => {}, sendDocument: async () => {} }),
    });
    try {
      await new Promise((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const tick = () => {
          try {
            if (fs.statSync(SOCKET_PATH).isSocket()) return resolve();
          } catch { /* not yet */ }
          if (Date.now() > deadline) return reject(new Error('stale file was not replaced by a socket'));
          setTimeout(tick, 25);
        };
        tick();
      });
      const res = await requestSend({ kind: 'text', chatId: 'e@s.whatsapp.net', text: 'after-stale' });
      assert.equal(res.ok, true);
    } finally {
      server.close();
    }
  });

  after(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });
});
