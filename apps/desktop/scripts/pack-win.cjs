const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const desktopDir = path.join(__dirname, '..');
const repoRoot = path.resolve(desktopDir, '../..');
const releaseDir = path.resolve(
  process.env.PACK_RELEASE_DIR ||
    (process.env.PACK_ON_SERVER ? '/tmp/mss-win-release' : path.join(desktopDir, 'release')),
);
const releasesDest = path.join(repoRoot, 'data', 'releases');
const CANONICAL_EXE = process.env.RELEASE_WINDOWS_FILE || 'MusicStreamService-setup.exe';
const isCi =
  process.env.GITHUB_ACTIONS === 'true' ||
  process.env.CI === 'true' ||
  process.env.PACK_CI === '1';
const skipPublishReleases =
  isCi || process.env.PACK_SKIP_RELEASES === '1' || process.env.PACK_ON_SERVER !== '1';

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function removePath(target) {
  for (let i = 0; i < 10; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      return;
    } catch (err) {
      if (i === 9) throw err;
      sleep(400 * (i + 1));
    }
  }
}

function cleanRelease() {
  if (!fs.existsSync(releaseDir)) return;
  for (const name of fs.readdirSync(releaseDir)) {
    if (
      name.endsWith('.lock') ||
      name.startsWith('win-unpacked') ||
      /MusicStreamService Setup/i.test(name) ||
      name === 'builder-debug.yml'
    ) {
      removePath(path.join(releaseDir, name));
    }
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd: cwd || desktopDir,
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
    stdio: 'inherit',
    shell: true,
  });
  return result.status ?? 1;
}

function findInstaller(dir) {
  if (!fs.existsSync(dir)) return null;
  const canonical = path.join(dir, CANONICAL_EXE);
  if (fs.existsSync(canonical)) return canonical;

  const names = fs.readdirSync(dir).filter((n) => n.endsWith('.exe') && !n.includes('uninstall'));
  const setup = names.filter((n) => /MusicStreamService Setup/i.test(n));
  if (setup.length) {
    setup.sort();
    return path.join(dir, setup[setup.length - 1]);
  }
  names.sort();
  return names.length ? path.join(dir, names[names.length - 1]) : null;
}

function cleanupReleasesDir() {
  fs.mkdirSync(releasesDest, { recursive: true });
  for (const name of fs.readdirSync(releasesDest)) {
    if (name.endsWith('.exe') && name !== CANONICAL_EXE) {
      removePath(path.join(releasesDest, name));
      console.log('data/releases: удалено', name);
    }
  }
}

function publishToReleases(exePath) {
  fs.mkdirSync(releasesDest, { recursive: true });
  cleanupReleasesDir();
  const dest = path.join(releasesDest, CANONICAL_EXE);
  fs.copyFileSync(exePath, dest);
  console.log('data/releases ←', CANONICAL_EXE);
  removePath(path.join(releaseDir, 'win-unpacked'));
}

fs.mkdirSync(releaseDir, { recursive: true });
cleanRelease();

if (!process.env.API_PUBLIC_URL) {
  console.warn('API_PUBLIC_URL не задан — в prod задайте URL с PUBLIC_BASE_PATH, напр. https://host/MusicStreamService');
}

const buildStatus = run('pnpm', ['run', 'build'], desktopDir);
if (buildStatus !== 0) process.exit(buildStatus);

const builderArgs = ['electron-builder', '--win', 'nsis', '--publish', 'never'];
// Релиз на GitHub — только через .github/workflows/release.yml (softprops/action-gh-release).
// Иначе при checkout tag electron-builder требует GH_TOKEN и падает после сборки NSIS.
if (process.platform === 'win32') {
  builderArgs.push('-c.electronDist=node_modules/electron/dist');
}
if (releaseDir !== path.join(desktopDir, 'release')) {
  builderArgs.push(`-c.directories.output=${releaseDir}`);
}

let packStatus = 1;
for (let attempt = 1; attempt <= 4; attempt++) {
  packStatus = run('pnpm', ['exec', ...builderArgs], desktopDir);
  if (packStatus === 0) break;
  console.warn(`electron-builder: попытка ${attempt}/4 не удалась, повтор…`);
  cleanRelease();
  sleep(2000 * attempt);
}

if (packStatus !== 0) process.exit(packStatus);

const exePath = findInstaller(releaseDir);
if (!exePath) {
  console.error('Установщик .exe не найден в', releaseDir);
  process.exit(1);
}

if (skipPublishReleases) {
  const ciOut = path.join(releaseDir, CANONICAL_EXE);
  if (path.resolve(exePath) !== path.resolve(ciOut)) {
    fs.copyFileSync(exePath, ciOut);
  }
  console.log('PACK_OUTPUT', ciOut);
  process.exit(0);
}

publishToReleases(exePath);
process.exit(0);
