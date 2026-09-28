#!/usr/bin/env node
/**
 * Синхронизирует version во всех package.json и Android с git-тегом vX.Y.Z.
 * Usage: node scripts/sync-version-from-tag.cjs v0.1.5
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const raw = (process.argv[2] || process.env.GITHUB_REF_NAME || '').trim();
const version = raw.replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error('Expected tag like v1.2.3, got:', raw || '(empty)');
  process.exit(1);
}

const parts = version.split('-')[0].split('.').map((n) => Number(n));
const versionCode = parts[0] * 1_000_000 + parts[1] * 1_000 + parts[2];

function setPackageVersion(rel) {
  const file = path.join(repoRoot, rel);
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  pkg.version = version.split('-')[0];
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log('version', pkg.version, '←', rel);
}

const packages = [
  'apps/desktop/package.json',
  'apps/api/package.json',
  'apps/worker/package.json',
  'packages/shared/package.json',
  'packages/mss-format/package.json',
  'packages/audio-engine/package.json',
  'packages/stream-connectors/package.json',
];

for (const rel of packages) setPackageVersion(rel);

const gradlePath = path.join(repoRoot, 'apps/android/app/build.gradle.kts');
let gradle = fs.readFileSync(gradlePath, 'utf8');
gradle = gradle.replace(/versionCode\s*=\s*\d+/, `versionCode = ${versionCode}`);
gradle = gradle.replace(/versionName\s*=\s*"[^"]*"/, `versionName = "${version.split('-')[0]}"`);
fs.writeFileSync(gradlePath, gradle);
console.log('android versionName', version.split('-')[0], 'versionCode', versionCode);
