const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * Spotify Web Player отдаёт лицензию Widevine только если VMP-подпись совпадает
 * с запущенным exe. electron-builder переименовывает electron.exe и дописывает
 * в него иконку и asar-integrity — подпись castlabs после этого недействительна,
 * а файл остаётся electron.exe.sig. Без валидной подписи лицензия отклоняется:
 * «трек недоступен», звук обрывается примерно через 10 секунд.
 *
 * Сначала пробуем production-подпись EVS (castlabs). Development-сертификат
 * Spotify не принимает: лицензия отклоняется, звук обрывается. Если аккаунта
 * EVS нет, возвращаем исходные байты electron.exe, чтобы подпись хотя бы
 * совпадала с файлом — этого недостаточно для полного воспроизведения.
 */
function evsPython() {
  return process.env.EVS_PYTHON || 'python';
}

function evsAvailable() {
  return spawnSync(evsPython(), ['-c', 'import castlabs_evs'], { stdio: 'ignore' }).status === 0;
}

/** `-n` — глобальный флаг, до подкоманды. Иначе клиент отвечает unrecognized arguments. */
function evsSign(appOutDir) {
  console.log('VMP: подписываем пакет через castlabs EVS (после иконки и версии exe)');
  const signed = spawnSync(evsPython(), ['-m', 'castlabs_evs.vmp', '-n', 'sign-pkg', appOutDir], {
    stdio: 'inherit',
  });
  if (signed.status !== 0) {
    throw new Error(
      'VMP: castlabs EVS не подписал пакет. Локально: py -3 -m castlabs_evs.account reauth. ' +
        'В GitHub Actions: секреты EVS_ACCOUNT_NAME и EVS_PASSWD.',
    );
  }
}

/** Только что собранный exe на Windows часто держит антивирус — EBUSY проходит за секунды. */
function copyWithRetry(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.copyFileSync(from, to);
      return;
    } catch (err) {
      if (attempt >= 8 || (err.code !== 'EBUSY' && err.code !== 'EPERM')) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * attempt);
    }
  }
}

function restoreDevSignature(appOutDir, exeName) {
  const electronDist = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
  const pristine = path.join(electronDist, 'electron.exe');
  const pristineSig = path.join(electronDist, 'electron.exe.sig');
  if (!fs.existsSync(pristine) || !fs.existsSync(pristineSig)) {
    console.warn('VMP: нет electron.exe.sig в', electronDist, '— Spotify не сможет расшифровать поток');
    return;
  }
  const exePath = path.join(appOutDir, exeName);
  copyWithRetry(pristine, exePath);
  copyWithRetry(pristineSig, path.join(appOutDir, `${exeName}.sig`));
  const stale = path.join(appOutDir, 'electron.exe.sig');
  if (fs.existsSync(stale) && path.basename(exeName) !== 'electron.exe') fs.rmSync(stale);
  console.log('VMP: development-подпись восстановлена как', `${exeName}.sig`);
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  const ci = process.env.GITHUB_ACTIONS === 'true' || process.env.CI === 'true' || process.env.PACK_CI === '1';
  if (evsAvailable()) {
    evsSign(context.appOutDir);
    const stale = path.join(context.appOutDir, 'electron.exe.sig');
    if (exeName !== 'electron.exe' && fs.existsSync(stale)) fs.rmSync(stale);
    return;
  }
  if (ci) {
    throw new Error(
      'VMP: в CI нет castlabs-evs. Workflow должен установить пакет и задать секреты EVS_ACCOUNT_NAME и EVS_PASSWD.',
    );
  }
  console.warn(
    'VMP: EVS недоступен. Development-подпись не откроет полный Spotify — нужен аккаунт https://github.com/castlabs/electron-releases/wiki/EVS',
  );
  restoreDevSignature(context.appOutDir, exeName);
};
