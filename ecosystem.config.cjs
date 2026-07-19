const path = require('path');
const os = require('os');

module.exports = {
  apps: [{
    name: 'zylos-whatsapp',
    script: 'src/index.js',
    cwd: path.join(os.homedir(), 'zylos/.claude/skills/whatsapp'),
    env: {
      NODE_ENV: 'production'
    },
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    // Memory backstop: known upstream leak vectors remain open in Baileys
    // 7.0.0-rc13 (e.g. WhiskeySockets/Baileys#2090); a graceful PM2 restart
    // at 1G beats an OOM kill. WhatsApp Web sessions survive restarts.
    max_memory_restart: '1G',
    error_file: path.join(os.homedir(), 'zylos/components/whatsapp/logs/error.log'),
    out_file: path.join(os.homedir(), 'zylos/components/whatsapp/logs/out.log'),
    log_date_format: 'YYYY-MM-DD HH:mm:ss'
  }]
};
