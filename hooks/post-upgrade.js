#!/usr/bin/env node
/**
 * Post-upgrade hook for zylos-whatsapp
 */

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/whatsapp');
const configPath = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(configPath)) {
  console.log('[post-upgrade] No config to migrate');
  process.exit(0);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
let migrated = false;

// Add message settings if missing
if (!config.message) {
  config.message = { context_messages: 10 };
  migrated = true;
}

// Add owner structure if missing
if (!config.owner) {
  config.owner = { bound: false, jid: '', name: '' };
  migrated = true;
}

if (migrated) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('[post-upgrade] Config migrated');
} else {
  console.log('[post-upgrade] No migration needed');
}
