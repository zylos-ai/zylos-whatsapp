#!/usr/bin/env node
/**
 * Post-install hook for zylos-whatsapp
 */

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/whatsapp');

const INITIAL_CONFIG = {
  enabled: true,
  owner: { bound: false, jid: '', name: '' },
  dmPolicy: 'owner',
  dmAllowFrom: [],
  groupPolicy: 'disabled',
  groups: {},
  message: { context_messages: 10 }
};

console.log('[post-install] Running whatsapp-specific setup...\n');

// 1. Create subdirectories
console.log('Creating subdirectories...');
for (const dir of ['logs', 'media', 'auth_info']) {
  fs.mkdirSync(path.join(DATA_DIR, dir), { recursive: true });
  console.log(`  - ${dir}/`);
}

// 2. Create default config
const configPath = path.join(DATA_DIR, 'config.json');
if (!fs.existsSync(configPath)) {
  console.log('\nCreating default config.json...');
  fs.writeFileSync(configPath, JSON.stringify(INITIAL_CONFIG, null, 2));
  console.log('  - config.json created');
} else {
  console.log('\nConfig already exists, skipping.');
}

console.log('\n[post-install] Complete!');
console.log('\nNext steps:');
console.log('  1. Start the service: pm2 start ecosystem.config.cjs');
console.log('  2. Check logs for QR code: pm2 logs zylos-whatsapp');
console.log('  3. Scan the QR code with your WhatsApp phone app');
