#!/usr/bin/env node
/**
 * Pre-upgrade hook for zylos-whatsapp
 */

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
const DATA_DIR = path.join(HOME, 'zylos/components/whatsapp');
const configPath = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(configPath)) {
  console.error('[pre-upgrade] Config not found, aborting');
  process.exit(1);
}

const backup = fs.readFileSync(configPath);
fs.writeFileSync(configPath + '.backup', backup);
console.log('[pre-upgrade] Config backup created');
