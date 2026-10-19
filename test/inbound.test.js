/**
 * Tests for pure inbound helpers: owner auto-bind gating and reply-via path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';

import {
  shouldBindOwner, messageTimestampMs, buildReplyVia, c4SendPath, OWNER_BIND_GRACE_MS
} from '../src/lib/inbound.js';

const CONNECTED_AT = 1_760_000_000_000; // epoch ms
const sec = (ms) => Math.floor(ms / 1000);

function live(overrides = {}) {
  return {
    ownerBound: false,
    isGroup: false,
    upsertType: 'notify',
    requestId: undefined,
    messageTimestamp: sec(CONNECTED_AT + 5000),
    connectedAt: CONNECTED_AT,
    ...overrides
  };
}

describe('shouldBindOwner', () => {
  it('binds on a real-time DM received after the connection opened', () => {
    assert.equal(shouldBindOwner(live()), true);
  });

  it('never binds once an owner is bound', () => {
    assert.equal(shouldBindOwner(live({ ownerBound: true })), false);
  });

  it('never binds from a group message', () => {
    assert.equal(shouldBindOwner(live({ isGroup: true })), false);
  });

  it("does not bind offline backlog (upsert type 'append')", () => {
    assert.equal(shouldBindOwner(live({ upsertType: 'append' })), false);
  });

  it('does not bind when the upsert type is unknown/missing', () => {
    assert.equal(shouldBindOwner(live({ upsertType: undefined })), false);
  });

  it('does not bind placeholder-resend replays (notify + requestId)', () => {
    assert.equal(shouldBindOwner(live({ requestId: 'ABC123' })), false);
  });

  it('does not bind a notify message stamped before the connection opened', () => {
    const old = sec(CONNECTED_AT - OWNER_BIND_GRACE_MS - 10_000);
    assert.equal(shouldBindOwner(live({ messageTimestamp: old })), false);
    const daysOld = sec(CONNECTED_AT - 3 * 86_400_000);
    assert.equal(shouldBindOwner(live({ messageTimestamp: daysOld })), false);
  });

  it('tolerates small clock skew within the grace window', () => {
    const skewed = sec(CONNECTED_AT - 30_000);
    assert.equal(shouldBindOwner(live({ messageTimestamp: skewed })), true);
  });

  it('fails closed without a timestamp or connection time', () => {
    assert.equal(shouldBindOwner(live({ messageTimestamp: undefined })), false);
    assert.equal(shouldBindOwner(live({ messageTimestamp: 0 })), false);
    assert.equal(shouldBindOwner(live({ connectedAt: 0 })), false);
    assert.equal(shouldBindOwner(live({ connectedAt: undefined })), false);
  });

  it('accepts Long-like and string timestamps', () => {
    const ts = sec(CONNECTED_AT + 1000);
    assert.equal(shouldBindOwner(live({ messageTimestamp: { toNumber: () => ts } })), true);
    assert.equal(shouldBindOwner(live({ messageTimestamp: String(ts) })), true);
  });
});

describe('messageTimestampMs', () => {
  it('converts seconds to ms and rejects junk', () => {
    assert.equal(messageTimestampMs(1700000000), 1700000000000);
    assert.equal(messageTimestampMs(null), null);
    assert.equal(messageTimestampMs('abc'), null);
    assert.equal(messageTimestampMs(-5), null);
  });
});

describe('reply-via path', () => {
  it('is built from the given home directory, not a hardcoded user', () => {
    assert.equal(
      c4SendPath('/home/alice'),
      '/home/alice/zylos/.claude/skills/comm-bridge/scripts/c4-send.js'
    );
    assert.equal(
      buildReplyVia('123@s.whatsapp.net|type:p2p|msg:XYZ', '/home/alice'),
      'node /home/alice/zylos/.claude/skills/comm-bridge/scripts/c4-send.js "whatsapp" "123@s.whatsapp.net|type:p2p|msg:XYZ"'
    );
  });

  it('defaults to os.homedir()', () => {
    const expected = path.join(os.homedir(), 'zylos/.claude/skills/comm-bridge/scripts/c4-send.js');
    assert.equal(c4SendPath(), expected);
    assert.ok(buildReplyVia('e').startsWith(`node ${expected} `));
  });
});
