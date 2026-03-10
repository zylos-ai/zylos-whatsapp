/**
 * Configuration loader for zylos-whatsapp
 *
 * Loads config from ~/zylos/components/whatsapp/config.json
 * with hot-reload support via file watcher.
 */

import fs from 'fs';
import path from 'path';

const HOME = process.env.HOME;
export const DATA_DIR = path.join(HOME, 'zylos/components/whatsapp');
export const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

export const DEFAULT_CONFIG = {
  enabled: true,
  owner: {
    bound: false,
    jid: '',
    name: ''
  },
  dmPolicy: 'owner',      // open | allowlist | owner
  dmAllowFrom: [],         // phone numbers in E.164 (e.g. "+8613800138000")
  groupPolicy: 'disabled', // disabled | allowlist | open
  groups: {},              // { "groupJid": { name, allowFrom, added_at } }
  message: {
    context_messages: 10
  }
};

let config = null;
let configWatcher = null;
let debounceTimer = null;

export function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf8');
      config = { ...DEFAULT_CONFIG, ...JSON.parse(content) };
    } else {
      console.warn(`[whatsapp] Config file not found: ${CONFIG_PATH}`);
      config = { ...DEFAULT_CONFIG };
    }
  } catch (err) {
    console.error(`[whatsapp] Failed to load config: ${err.message}`);
    config = { ...DEFAULT_CONFIG };
  }
  return config;
}

export function getConfig() {
  if (!config) loadConfig();
  return config;
}

export function saveConfig(newConfig) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
    config = newConfig;
  } catch (err) {
    console.error(`[whatsapp] Failed to save config: ${err.message}`);
    throw err;
  }
}

export function watchConfig(onChange) {
  if (configWatcher) configWatcher.close();
  if (fs.existsSync(CONFIG_PATH)) {
    configWatcher = fs.watch(path.dirname(CONFIG_PATH), (eventType, filename) => {
      if (filename !== 'config.json') return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        console.log('[whatsapp] Config file changed, reloading...');
        loadConfig();
        if (onChange) onChange(config);
      }, 100);
    });
    configWatcher.on('error', (err) => {
      console.warn(`[whatsapp] Config watcher error: ${err.message}`);
    });
  }
}

export function stopWatching() {
  if (configWatcher) {
    configWatcher.close();
    configWatcher = null;
  }
}
