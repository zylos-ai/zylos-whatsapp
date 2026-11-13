/**
 * Tests for chat notices: cooldown per chat, echo suppression, quoting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createChatNotifier } from '../src/lib/notice.js';

const quiet = { log() {}, error() {} };

function notifier({ fail = false } = {}) {
  let clock = 0;
  let n = 0;
  const events = [];
  const notify = createChatNotifier({
    sendText: async (jid, text, options) => {
      events.push({ send: jid, text, options });
      if (fail) throw new Error('not connected');
    },
    markOwnMessage: (id) => events.push({ marked: id }),
    generateId: () => `ID${++n}`,
    cooldownMs: 60_000,
    now: () => clock,
    logger: quiet
  });
  return { notify, events, advance: (ms) => { clock += ms; } };
}

describe('createChatNotifier', () => {
  it('marks the notice id as processed before sending it, so its echo is skipped', async () => {
    const { notify, events } = notifier();
    assert.equal(await notify({ chatJid: 'a@s.whatsapp.net', text: 'sorry' }), true);
    assert.deepEqual(events, [
      { marked: 'ID1' },
      { send: 'a@s.whatsapp.net', text: 'sorry', options: { messageId: 'ID1' } }
    ]);
  });

  it('sends at most one notice per chat per cooldown', async () => {
    const { notify, events, advance } = notifier();
    assert.equal(await notify({ chatJid: 'g@g.us', text: 'x' }), true);
    assert.equal(await notify({ chatJid: 'g@g.us', text: 'x' }), false);
    assert.equal(await notify({ chatJid: 'b@lid', text: 'x' }), true, 'other chats are independent');
    advance(59_999);
    assert.equal(await notify({ chatJid: 'g@g.us', text: 'x' }), false);
    advance(1);
    assert.equal(await notify({ chatJid: 'g@g.us', text: 'x' }), true);
    assert.deepEqual(events.filter((e) => e.send).map((e) => e.send), ['g@g.us', 'b@lid', 'g@g.us']);
  });

  it('quotes the original message when given', async () => {
    const { notify, events } = notifier();
    const msg = { key: { id: 'orig' } };
    await notify({ chatJid: 'g@g.us', text: 'x', quoted: msg });
    assert.equal(events[1].options.quoted, msg);
  });

  it('a send failure is logged, not thrown', async () => {
    const { notify } = notifier({ fail: true });
    assert.equal(await notify({ chatJid: 'a@lid', text: 'x' }), false);
  });
});
