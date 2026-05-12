const path = require('path');

const BOT_ROOT = __dirname;

module.exports = {
  apps: [
    {
      name: 'opensea-sweep-bot',
      script: path.join(BOT_ROOT, 'dist', 'index.js'),
      cwd: BOT_ROOT,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '5m',
      exp_backoff_restart_delay: 1000,
      out_file: path.join(BOT_ROOT, 'logs', 'out.log'),
      error_file: path.join(BOT_ROOT, 'logs', 'error.log'),
      time: true,
    },
  ],
};
