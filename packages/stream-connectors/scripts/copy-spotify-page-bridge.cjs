const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'spotify-page-bridge.inject.js');
const dist = path.join(__dirname, '..', 'dist', 'spotify-page-bridge.inject.js');
const android = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'apps',
  'android',
  'core',
  'connectors',
  'src',
  'main',
  'assets',
  'spotify-page-bridge.inject.js',
);

fs.mkdirSync(path.dirname(dist), { recursive: true });
fs.copyFileSync(src, dist);
fs.mkdirSync(path.dirname(android), { recursive: true });
fs.copyFileSync(src, android);
