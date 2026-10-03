import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installBridgeSource } from '../dist/spotify/bridge.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const injectPath = path.join(root, '../src/spotify-page-bridge.inject.js');
const androidPath = path.resolve(root, '../../../apps/android/core/connectors/src/main/assets/spotify-page-bridge.inject.js');

const out = installBridgeSource();
fs.mkdirSync(path.dirname(injectPath), { recursive: true });
fs.writeFileSync(injectPath, out);
fs.mkdirSync(path.dirname(androidPath), { recursive: true });
fs.writeFileSync(androidPath, out);
console.log('wrote bridge inject', injectPath, 'and', androidPath);
