import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { sessionGroupFromEndpoint } from './session-group.js';

export const GENERIC_REJECT_REPLY = "Sorry, I couldn't take this message right now. Please try again later.";
export const UNCERTAIN_REPLY = "Sorry, this message may not have reached me. If you don't get a reply in a few minutes, please send it again.";

/**
 * Whether the installed Core lists an optional c4-receive argument.
 * Reads `c4-receive-options.json` beside the c4-receive script on every call,
 * so a Core upgrade needs no restart. Missing or unreadable files, invalid
 * JSON and invalid shapes all mean unsupported.
 */
export function c4ReceiveSupportsOption(c4Receive, name) {
  try {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(path.dirname(c4Receive), 'c4-receive-options.json'), 'utf8'));
    return manifest !== null && typeof manifest === 'object' && !Array.isArray(manifest)
      && manifest.options !== null && typeof manifest.options === 'object'
      && !Array.isArray(manifest.options) && Object.hasOwn(manifest.options, name);
  } catch {
    return false;
  }
}

/**
 * Classify a structured c4-receive rejection by `error.persisted`:
 * non-empty array -> 'committed' (stored; send nothing, do not resend),
 * empty array -> 'not_stored', anything else -> 'uncertain'.
 */
export function classifyC4Rejection(response) {
  const persisted = response?.error?.persisted;
  if (!Array.isArray(persisted)) return 'uncertain';
  return persisted.length > 0 ? 'committed' : 'not_stored';
}

function parseC4Response(stdout) {
  if (!stdout) return null;
  try {
    return JSON.parse(String(stdout).trim());
  } catch {
    return null;
  }
}

/**
 * True when c4-receive never started (spawn itself failed), so Core cannot
 * have stored anything. Any other failure has an unknown outcome.
 */
function neverStarted(error) {
  return typeof error?.code === 'string'
    && typeof error.syscall === 'string' && error.syscall.startsWith('spawn');
}

/**
 * Send one inbound message to Core via c4-receive.
 *
 * On a multi-session Core (its options manifest lists --session-group) the
 * session group and --json are passed, and rejections are classified by
 * `error.persisted`. Older Cores receive exactly the same arguments as before;
 * any failure there is an unknown outcome. An endpoint that cannot be mapped
 * is not sent: it never falls back to the overall group. Core's error text
 * only goes to the log.
 *
 * c4-receive runs without a timeout: Core may still be routing the message or
 * sending a status notice after storing it, and it has no inbound idempotency
 * key. A call that is stored or whose outcome is unknown is never retried;
 * only a call that never started is retried once.
 *
 * @returns {Promise<{ outcome: 'sent'|'committed'|'not_stored'|'uncertain', notice: string|null }>}
 *   `notice` is the text to send the WhatsApp chat, or null to send nothing.
 */
export async function sendToC4({
  c4Receive,
  endpoint,
  content,
  execFileImpl = execFile,
  retryDelayMs = 2000,
  logger = console
}) {
  for (let attempt = 1; ; attempt += 1) {
    const args = [c4Receive, '--channel', 'whatsapp', '--endpoint', endpoint, '--content', content];
    let sessionGroup;
    if (c4ReceiveSupportsOption(c4Receive, '--session-group')) {
      try {
        sessionGroup = sessionGroupFromEndpoint(endpoint);
      } catch (err) {
        logger.error(`[whatsapp] No session group for ${endpoint}, not sent: ${err.message}`);
        return { outcome: 'not_stored', notice: GENERIC_REJECT_REPLY };
      }
      args.push('--json', '--session-group', sessionGroup);
    }

    const { error, stdout } = await new Promise((resolve) => {
      execFileImpl('node', args, { encoding: 'utf8' }, (err, out) => resolve({ error: err, stdout: out }));
    });
    const response = sessionGroup ? parseC4Response(stdout) : null;

    if (response && response.ok === false && response.error) {
      const kind = classifyC4Rejection(response);
      const { code, message } = response.error;
      if (kind === 'committed') {
        logger.warn(`[whatsapp] C4 rejected after commit (${code}), not resending: ${message}`);
        return { outcome: 'committed', notice: null };
      }
      logger.warn(`[whatsapp] C4 rejected (${code}, ${kind}) [group=${sessionGroup}]: ${message}`);
      return { outcome: kind, notice: kind === 'not_stored' ? GENERIC_REJECT_REPLY : UNCERTAIN_REPLY };
    }

    if (!error) return { outcome: 'sent', notice: null };

    if (!neverStarted(error) || attempt >= 2) {
      logger.error(`[whatsapp] C4 receive failed, outcome unknown, not resending: ${error.message}`);
      return { outcome: 'uncertain', notice: UNCERTAIN_REPLY };
    }

    logger.warn(`[whatsapp] C4 receive did not start, retrying in ${retryDelayMs}ms: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
