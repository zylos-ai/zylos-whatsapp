/**
 * Tests for the session-group mapping and its lookup script.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

import { isValidSessionGroup, sessionGroupFromEndpoint } from '../src/lib/session-group.js';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), '../scripts/session-group.js');

const MAPPED = [
  ['8613800138000@s.whatsapp.net|type:p2p|msg:3EB0A1', 'dm-8613800138000:s.whatsapp.net'],
  ['123456789012345@lid|type:p2p|msg:3EB0A2', 'dm-123456789012345:lid'],
  ['120363012345678901@g.us|type:group|msg:3EB0A3', 'group-120363012345678901:g.us'],
  ['8613800138000-1600000000@g.us|type:group|msg:3EB0A4', 'group-8613800138000-1600000000:g.us'],
  // per-message parts never affect the group
  ['120363012345678901@g.us|type:group|msg:OTHER', 'group-120363012345678901:g.us'],
];

const INVALID = [
  '',
  '8613800138000@s.whatsapp.net',                     // no type
  '8613800138000@s.whatsapp.net|type:dm|msg:x',       // unknown type
  '8613800138000|type:p2p|msg:x',                     // no '@'
  '8613800138000:12@s.whatsapp.net|type:p2p|msg:x',   // device suffix: ':' is ambiguous
  'a@b@c|type:p2p|msg:x',                             // two '@'
  '120363012345678901@newsletter|type:p2p|msg:x',     // newsletter is not a person
  'status@broadcast|type:p2p|msg:x',
  '120363012345678901@g.us|type:p2p|msg:x',           // group JID as a DM
  '8613800138000@s.whatsapp.net|type:group|msg:x',    // person JID as a group
  '|type:p2p|msg:x',
  `${'1'.repeat(80)}@s.whatsapp.net|type:p2p`,        // over 95 characters, never truncated
];

describe('session groups', () => {
  it('maps each conversation type to its session group', () => {
    for (const [endpoint, group] of MAPPED) {
      assert.equal(sessionGroupFromEndpoint(endpoint), group, endpoint);
      assert.equal(isValidSessionGroup(group), true, group);
    }
  });

  it('is reversible to the JID', () => {
    for (const [endpoint, group] of MAPPED) {
      const jid = group.slice(group.indexOf('-') + 1).replace(':', '@');
      assert.equal(jid, endpoint.split('|')[0]);
    }
  });

  it('throws for endpoints it cannot map instead of using the overall group', () => {
    for (const endpoint of [...INVALID, null, undefined]) {
      assert.throws(() => sessionGroupFromEndpoint(endpoint), Error, String(endpoint));
    }
  });

  it('isValidSessionGroup matches Core syntax', () => {
    for (const name of ['dm-1:lid', 'x'.repeat(95)]) assert.equal(isValidSessionGroup(name), true, name);
    for (const name of ['', '-a', 'a@b', 'a b', 'x'.repeat(96), null, 42]) {
      assert.equal(isValidSessionGroup(name), false, String(name));
    }
  });

  it('CLI prints the same group the receiver sends', () => {
    for (const [endpoint, group] of MAPPED) {
      assert.equal(execFileSync(process.execPath, [script, endpoint], { encoding: 'utf8' }), `${group}\n`);
    }
  });

  it('CLI failure exits 1 with nothing on stdout', () => {
    for (const args of [[], ['a', 'b'], [''], ['8613800138000|type:p2p']]) {
      assert.throws(() => execFileSync(process.execPath, [script, ...args], { stdio: 'pipe' }),
        (err) => err.status === 1 && err.stdout.toString() === '' && err.stderr.toString() !== '');
    }
  });
});
