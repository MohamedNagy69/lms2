const path = require('node:path');

const root = path.resolve(__dirname, '..');
module.exports = {
  apps: [
    {
      name: 'mudarris-api',
      cwd: path.join(root, 'apps/api'),
      script: 'dist/server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'mudarris-web',
      cwd: path.join(root, 'apps/web'),
      script: path.join(root, 'node_modules/next/dist/bin/next'),
      args: 'start --hostname 127.0.0.1',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
