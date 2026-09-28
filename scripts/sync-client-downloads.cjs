#!/usr/bin/env node
/** Копирует bootstrap Windows: scripts/client-install → apps/api/public/downloads */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(__dirname, 'client-install');
const dest = path.join(root, 'apps/api/public/downloads');
const files = ['common.ps1', 'install-windows.ps1', 'install-windows.cmd'];

fs.mkdirSync(dest, { recursive: true });
for (const name of files) {
  const from = path.join(src, name);
  const to = path.join(dest, name);
  if (!fs.existsSync(from)) {
    console.error('missing', from);
    process.exit(1);
  }
  fs.copyFileSync(from, to);
}
console.log('sync-client-downloads:', files.join(', '));
