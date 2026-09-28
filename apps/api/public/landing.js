function apiUrl(relativePath) {
  const base = document.querySelector('base')?.href;
  if (base) return new URL(relativePath.replace(/^\//, ''), base).href;
  return relativePath;
}

/** Убирает лишний «/#» в конце URL после загрузки */
function stripEmptyHash() {
  if (location.hash !== '#') return;
  history.replaceState(null, '', location.pathname + location.search);
}

async function initDownloads() {
  const section = document.querySelector('.downloads');
  const bootstrapBtn = document.getElementById('btn-win-bootstrap');
  const exeBtn = document.getElementById('btn-win-exe');
  const apkBtn = document.getElementById('btn-android');
  const releaseBtn = document.getElementById('btn-github-release');
  const hint = document.getElementById('dl-hint');
  if (!bootstrapBtn || !exeBtn || !apkBtn || !releaseBtn || !hint) return;

  section?.classList.add('is-loading');

  try {
    const res = await fetch(apiUrl('site/downloads'));
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const available = [];

    if (data.windowsBootstrap?.available && data.windowsBootstrap.cmdHref) {
      bootstrapBtn.hidden = false;
      bootstrapBtn.href = apiUrl(data.windowsBootstrap.cmdHref);
      available.push('Windows (bootstrap)');
    }

    if (data.windowsExe?.available && data.windowsExe.href) {
      exeBtn.hidden = false;
      exeBtn.href = data.windowsExe.href;
      available.push('Windows (.exe)');
    }

    if (data.androidApk?.available && data.androidApk.href) {
      apkBtn.hidden = false;
      apkBtn.href = data.androidApk.href;
      available.push('Android (APK)');
    }

    if (data.release?.githubReleasePage) {
      releaseBtn.hidden = false;
      releaseBtn.href = data.release.githubReleasePage;
    }

    const tag = data.release?.tag ? ` · ${data.release.tag}` : '';
    const ghReady = data.windowsExe?.available || data.androidApk?.available;

    if (available.length === 0) {
      hint.textContent =
        'Пока нет готовых установщиков. Задайте GITHUB_REPO на сервере и опубликуйте tag v* с assets, либо положите bootstrap в public/downloads/.';
    } else if (ghReady) {
      hint.textContent = `Скачивание: ${available.join(', ')}${tag}.`;
    } else if (data.windowsBootstrap?.available) {
      hint.textContent =
        'Windows: bootstrap соберёт клиент на вашем ПК. .exe и APK появятся после GitHub Release (tag v*).';
    } else {
      hint.textContent = `Доступно: ${available.join(', ')}${tag}.`;
    }
  } catch {
    hint.textContent = 'Не удалось загрузить ссылки. Проверьте API и обновите страницу.';
  } finally {
    section?.classList.remove('is-loading');
  }
}

stripEmptyHash();
void initDownloads();
