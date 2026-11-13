/**
 * Session-group mapping for zylos-core multi-session mode.
 *
 * The group name is derived only from the reply endpoint, so the inbound
 * `--session-group` value and `scripts/session-group.js <endpoint>` always
 * agree. Rules (fixed once live; changing them needs a migration with Core):
 *   `<jid>|type:p2p|msg:<id>`   -> dm-<jid with '@' as ':'>
 *   `<jid>|type:group|msg:<id>` -> group-<jid with '@' as ':'>
 *   e.g. 8613800138000@s.whatsapp.net -> dm-8613800138000:s.whatsapp.net
 *        120363012345678901@g.us      -> group-120363012345678901:g.us
 *
 * Core only accepts [A-Za-z0-9_.:-]. The JID keeps its domain, so phone-number
 * (@s.whatsapp.net) and LID (@lid) chats stay distinct. Only person JIDs
 * (s.whatsapp.net, lid) map to dm- and only group JIDs (g.us) to group-;
 * newsletters, broadcasts and anything else throw. A JID must contain exactly
 * one '@' and no ':' (a device suffix such as `123:4@s.whatsapp.net` would make
 * the name ambiguous), so the mapping is one-to-one. Per-message parts (msg)
 * never take part. Ids are never truncated or hashed. Core adds the
 * `whatsapp:` namespace.
 */

/** Core's limits for the name a component passes (Core adds `<namespace>:`). */
export const SESSION_GROUP_MAX_LENGTH = 95;
export const SESSION_GROUP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

const JID = /^([A-Za-z0-9][A-Za-z0-9_.-]*)@([A-Za-z0-9][A-Za-z0-9.-]*)$/;
const PREFIX = { p2p: 'dm', group: 'group' };
const DOMAINS = { p2p: ['s.whatsapp.net', 'lid'], group: ['g.us'] };

/**
 * Whether Core would accept this nonempty name.
 * @param {string} name
 * @returns {boolean}
 */
export function isValidSessionGroup(name) {
  return typeof name === 'string' && name.length <= SESSION_GROUP_MAX_LENGTH
    && SESSION_GROUP_PATTERN.test(name);
}

const quote = (value, max = 64) => JSON.stringify(String(value ?? '').slice(0, max));

/**
 * Derive the in-group session name from an endpoint string.
 * @param {string} endpoint - e.g. "8613800138000@s.whatsapp.net|type:p2p|msg:ABC"
 * @returns {string} group name without namespace (never '')
 * @throws {Error} when the endpoint cannot be mapped
 */
export function sessionGroupFromEndpoint(endpoint) {
  const parts = String(endpoint ?? '').split('|');
  const jid = parts[0];
  const type = parts.slice(1).find((part) => part.startsWith('type:'))?.slice('type:'.length);

  if (type === undefined) throw new Error(`endpoint has no type: ${quote(endpoint)}`);
  const prefix = PREFIX[type];
  if (!prefix) throw new Error(`unknown chat type in endpoint: ${quote(type, 32)}`);
  const match = JID.exec(jid);
  if (!match) throw new Error(`invalid WhatsApp JID in endpoint: ${quote(endpoint)}`);
  if (!DOMAINS[type].includes(match[2])) {
    throw new Error(`${type} endpoint with a ${quote(match[2], 32)} JID is not a conversation this component maps`);
  }

  const name = `${prefix}-${jid.replace('@', ':')}`;
  if (!isValidSessionGroup(name)) {
    throw new Error(`session group would be invalid for Core (length ${name.length}, max ${SESSION_GROUP_MAX_LENGTH})`);
  }
  return name;
}
