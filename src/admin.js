#!/usr/bin/env node
/**
 * Admin CLI for zylos-whatsapp
 *
 * Usage:
 *   node admin.js show                           - Show current config
 *   node admin.js set-dm-policy <policy>          - Set DM policy (open|allowlist|owner)
 *   node admin.js add-dm-allow <phone>            - Add phone to DM allowlist
 *   node admin.js remove-dm-allow <phone>         - Remove phone from DM allowlist
 *   node admin.js set-group-policy <policy>       - Set group policy (disabled|allowlist|open)
 *   node admin.js add-group <jid> <name>          - Add group to allowlist
 *   node admin.js remove-group <jid>              - Remove group from allowlist
 *   node admin.js clear-auth                      - Clear auth session (requires re-scan)
 */

import fs from 'fs';
import path from 'path';
import { getConfig, saveConfig, DATA_DIR } from './lib/config.js';

const command = process.argv[2];
const args = process.argv.slice(3);

const commands = {
  'show': () => {
    const config = getConfig();
    console.log(JSON.stringify(config, null, 2));
  },

  'set-dm-policy': (policy) => {
    const valid = ['open', 'allowlist', 'owner'];
    if (!valid.includes(policy)) {
      console.error(`Invalid policy. Must be one of: ${valid.join(', ')}`);
      process.exit(1);
    }
    const config = getConfig();
    config.dmPolicy = policy;
    saveConfig(config);
    console.log(`DM policy set to: ${policy}`);
  },

  'add-dm-allow': (phone) => {
    if (!phone) { console.error('Phone required'); process.exit(1); }
    const config = getConfig();
    if (!config.dmAllowFrom) config.dmAllowFrom = [];
    if (!config.dmAllowFrom.includes(phone)) {
      config.dmAllowFrom.push(phone);
      saveConfig(config);
      console.log(`Added ${phone} to DM allowlist`);
    } else {
      console.log(`${phone} already in DM allowlist`);
    }
  },

  'remove-dm-allow': (phone) => {
    if (!phone) { console.error('Phone required'); process.exit(1); }
    const config = getConfig();
    config.dmAllowFrom = (config.dmAllowFrom || []).filter(p => p !== phone);
    saveConfig(config);
    console.log(`Removed ${phone} from DM allowlist`);
  },

  'set-group-policy': (policy) => {
    const valid = ['disabled', 'allowlist', 'open'];
    if (!valid.includes(policy)) {
      console.error(`Invalid policy. Must be one of: ${valid.join(', ')}`);
      process.exit(1);
    }
    const config = getConfig();
    config.groupPolicy = policy;
    saveConfig(config);
    console.log(`Group policy set to: ${policy}`);
  },

  'add-group': (jid, name) => {
    if (!jid || !name) { console.error('Usage: add-group <jid> <name>'); process.exit(1); }
    const config = getConfig();
    if (!config.groups) config.groups = {};
    config.groups[jid] = {
      name,
      allowFrom: [],
      added_at: new Date().toISOString()
    };
    saveConfig(config);
    console.log(`Added group ${name} (${jid})`);
  },

  'remove-group': (jid) => {
    if (!jid) { console.error('Usage: remove-group <jid>'); process.exit(1); }
    const config = getConfig();
    if (config.groups?.[jid]) {
      delete config.groups[jid];
      saveConfig(config);
      console.log(`Removed group ${jid}`);
    } else {
      console.log(`Group ${jid} not found`);
    }
  },

  'clear-auth': () => {
    const authDir = path.join(DATA_DIR, 'auth_info');
    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true });
      console.log('Auth session cleared. Restart the service to re-scan QR.');
    } else {
      console.log('No auth session found.');
    }
  }
};

if (!command || !commands[command]) {
  console.log('Available commands:');
  Object.keys(commands).forEach(cmd => console.log(`  ${cmd}`));
  process.exit(0);
}

commands[command](...args);
