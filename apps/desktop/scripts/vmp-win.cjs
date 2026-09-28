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
 * Сначала пробуем production-подпись EVS (castlabs). Если аккаунта нет —
 * возвращаем исходные байты electron.exe и кладём подпись рядом с итоговым именем.
 */
function tryEvsSign(appOutDir) {
  const python = process.env.EVS_PYTHON || 'python';
  const imported = spawnSync(python, ['-c', 'import castlabs_evs'], { stdio: 'ignore' });
  if (imported.status !== 0) return false;
  console.log('VMP: подписываем пакет через castlabs EVS');
  const signed = spawnSync(python, ['-m', 'castlabs_evs.vmp', 'sign-pkg', '--no-ask', appOutDir], {
    stdio: 'inherit',
  });
  return signed.status === 0;
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
  fs.copyFileSync(pristine, exePath);
  fs.copyFileSync(pristineSig, path.join(appOutDir, `${exeName}.sig`));
  const stale = path.join(appOutDir, 'electron.exe.sig');
  if (fs.existsSync(stale) && path.basename(exeName) !== 'electron.exe') fs.rmSync(stale);
  console.log('VMP: development-подпись восстановлена как', `${exeName}.sig`);
}

module.exports = async function afterSign(context) {
  if (context.electronPlatformName !== 'win32') return;
  const exeName = `${context.packager.appInfo.productFilename}.exe`;
  if (tryEvsSign(context.appOutDir)) {
    const stale = path.join(context.appOutDir, 'electron.exe.sig');
    if (exeName !== 'electron.exe' && fs.existsSync(stale)) fs.rmSync(stale);
    return;
  }
  console.warn('VMP: EVS недоступен, возвращаем development-подпись castlabs (иконка exe будет стандартной)');
  restoreDevSignature(context.appOutDir, exeName);
};
