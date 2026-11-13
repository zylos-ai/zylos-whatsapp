/**
 * Tests for sending inbound messages to Core (c4-receive) with an injected execFile.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { GENERIC_REJECT_REPLY, UNCERTAIN_REPLY, sendToC4 } from '../src/lib/c4.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whatsapp-c4-'));
const c4Receive = path.join(dir, 'c4-receive.js');
const manifestPath = path.join(dir, 'c4-receive-options.json');
const ENDPOINT = '8613800138000@s.whatsapp.net|type:p2p|msg:3EB0A1';
const GROUP = 'dm-8613800138000:s.whatsapp.net';
const OLD_ARGS = [c4Receive, '--channel', 'whatsapp', '--endpoint', ENDPOINT, '--content', 'hi'];
const NEW_ARGS = [...OLD_ARGS, '--json', '--session-group', GROUP];
const quiet = { log() {}, warn() {}, error() {} };

const rejection = (persisted) => {
  const body = { code: 'X', message: 'internal core text' };
  if (persisted !== undefined) body.persisted = persisted;
  return { error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: JSON.stringify({ ok: false, error: body }) };
};
const spawnFailure = () => ({ error: Object.assign(new Error('spawn node ENOENT'), { code: 'ENOENT', syscall: 'spawn node' }), stdout: '' });

function run(results, endpoint = ENDPOINT) {
  const calls = [];
  const execFileImpl = (cmd, args, options, cb) => {
    calls.push({ args, options });
    const result = results[Math.min(calls.length - 1, results.length - 1)];
    setImmediate(() => cb(result.error ?? null, result.stdout ?? '', ''));
  };
  return sendToC4({ c4Receive, endpoint, content: 'hi', execFileImpl, retryDelayMs: 1, logger: quiet })
    .then((result) => ({ result, calls }));
}

const multiSession = () => fs.writeFileSync(manifestPath,
  JSON.stringify({ options: { '--json': { takesValue: false }, '--session-group': { takesValue: true } } }));

afterEach(() => fs.rmSync(manifestPath, { force: true }));

describe('sendToC4', () => {
  it('older Core receives exactly the pre-change arguments, even for unmappable endpoints', async () => {
    for (const manifest of [null, { options: { '--json': { takesValue: false } } }]) {
      if (manifest) fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      const { result, calls } = await run([{ stdout: '[C4] Message queued' }]);
      assert.deepEqual(result, { outcome: 'sent', notice: null });
      assert.deepEqual(calls[0].args, OLD_ARGS);
      const bad = await run([{ stdout: '' }], 'not-a-jid|type:p2p');
      assert.equal(bad.result.outcome, 'sent');
    }
  });

  it('older Core failure is an unknown outcome, not resent', async () => {
    const { result, calls } = await run([{ error: Object.assign(new Error('exit 1'), { code: 1 }), stdout: '' }]);
    assert.deepEqual(result, { outcome: 'uncertain', notice: UNCERTAIN_REPLY });
    assert.equal(calls.length, 1);
  });

  it('multi-session Core receives --json and the group, with no component timeout', async () => {
    multiSession();
    const { result, calls } = await run([{ stdout: '{"ok":true}' }]);
    assert.deepEqual(result, { outcome: 'sent', notice: null });
    assert.deepEqual(calls[0].args, NEW_ARGS);
    assert.equal(calls[0].options.timeout, undefined);
  });

  it('unmappable endpoint on multi-session Core is never sent', async () => {
    multiSession();
    const { result, calls } = await run([{ stdout: '{"ok":true}' }], '8613800138000:12@s.whatsapp.net|type:p2p|msg:x');
    assert.deepEqual(result, { outcome: 'not_stored', notice: GENERIC_REJECT_REPLY });
    assert.deepEqual(calls, []);
  });

  it('classifies rejections by persisted, never resends, never shows Core text', async () => {
    multiSession();
    const cases = [
      [rejection(['D1']), { outcome: 'committed', notice: null }],
      [rejection([]), { outcome: 'not_stored', notice: GENERIC_REJECT_REPLY }],
      [rejection(null), { outcome: 'uncertain', notice: UNCERTAIN_REPLY }],
      [rejection(undefined), { outcome: 'uncertain', notice: UNCERTAIN_REPLY }]
    ];
    for (const [response, expected] of cases) {
      const { result, calls } = await run([response]);
      assert.deepEqual(result, expected);
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0].args, NEW_ARGS);
    }
  });

  it('a process that never started is retried once with the same arguments', async () => {
    multiSession();
    const ok = await run([spawnFailure(), { stdout: '{"ok":true}' }]);
    assert.deepEqual(ok.result, { outcome: 'sent', notice: null });
    assert.deepEqual(ok.calls.map((c) => c.args), [NEW_ARGS, NEW_ARGS]);

    const failed = await run([spawnFailure(), spawnFailure()]);
    assert.deepEqual(failed.result, { outcome: 'uncertain', notice: UNCERTAIN_REPLY });
    assert.equal(failed.calls.length, 2);
  });
});
