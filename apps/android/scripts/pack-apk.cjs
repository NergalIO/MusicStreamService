const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const androidDir = path.join(__dirname, '..');
const repoRoot = path.resolve(androidDir, '../..');
const releasesDest = path.join(repoRoot, 'data', 'releases');
const CANONICAL_APK = process.env.RELEASE_ANDROID_FILE || 'mss-android.apk';

function chmodGradlew() {
  if (process.platform === 'win32') return;
  try {
    fs.chmodSync(path.join(androidDir, 'gradlew'), 0o755);
  } catch {
    /* ignore */
  }
}

function findApk() {
  const candidates = [
    path.join(androidDir, 'app/build/outputs/apk/debug/app-debug.apk'),
    path.join(androidDir, 'app/build/outputs/apk/release/app-release.apk'),
    path.join(androidDir, 'app/build/outputs/apk/release/app-release-unsigned.apk'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function cleanupReleasesDir() {
  fs.mkdirSync(releasesDest, { recursive: true });
  for (const name of fs.readdirSync(releasesDest)) {
    if (name.endsWith('.apk') && name !== CANONICAL_APK) {
      fs.rmSync(path.join(releasesDest, name), { force: true });
      console.log('data/releases: удалено', name);
    }
  }
}

function writeLocalProperties() {
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME;
  if (!sdk) return;
  const sdkDir = sdk.replace(/\\/g, '/');
  fs.writeFileSync(path.join(androidDir, 'local.properties'), `sdk.dir=${sdkDir}\n`);
}

function gradleEnv() {
  const env = { ...process.env };
  if (process.env.GRADLE_JVM_ARGS) {
    env.ORG_GRADLE_PROJECT_org_gradle_jvmargs = process.env.GRADLE_JVM_ARGS;
  }
  env.GRADLE_OPTS = [env.GRADLE_OPTS, '-Dorg.gradle.daemon=false'].filter(Boolean).join(' ');
  return env;
}

function runGradle(args) {
  const gradle = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
  const r = spawnSync(gradle, args, {
    cwd: androidDir,
    stdio: 'inherit',
    shell: false,
    env: gradleEnv(),
  });
  return r.status ?? 1;
}

writeLocalProperties();
chmodGradlew();

const variant = process.env.APK_VARIANT === 'release' ? ':app:assembleRelease' : ':app:assembleDebug';
const status = runGradle([variant, '--no-daemon', '--max-workers=1']);
if (status !== 0) process.exit(status);

const apk = findApk();
if (!apk) {
  console.error('APK не найден после сборки');
  process.exit(1);
}

cleanupReleasesDir();
fs.mkdirSync(releasesDest, { recursive: true });
fs.copyFileSync(apk, path.join(releasesDest, CANONICAL_APK));
console.log('data/releases ←', CANONICAL_APK);

if (process.env.PACK_ON_SERVER === '1') {
  for (const dir of [
    path.join(androidDir, 'app', 'build'),
    path.join(androidDir, 'build'),
    path.join(androidDir, '.gradle'),
  ]) {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log('очищено', path.relative(repoRoot, dir));
    }
  }
}
process.exit(0);
