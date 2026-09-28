async function initDownloads() {
  const bootstrapBtn = document.getElementById('btn-win-bootstrap');
  const exeBtn = document.getElementById('btn-win-exe');
  const apkBtn = document.getElementById('btn-android');
  const releaseBtn = document.getElementById('btn-github-release');
  const hint = document.getElementById('dl-hint');
  if (!bootstrapBtn || !exeBtn || !apkBtn || !releaseBtn || !hint) return;

  try {
    const res = await fetch('site/downloads');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    let any = false;

    if (data.windowsBootstrap?.available && data.windowsBootstrap.cmdHref) {
      bootstrapBtn.hidden = false;
      bootstrapBtn.setAttribute('href', data.windowsBootstrap.cmdHref.replace(/^\//, ''));
      any = true;
    }

    if (data.windowsExe?.available && data.windowsExe.href) {
      exeBtn.hidden = false;
      exeBtn.setAttribute('href', data.windowsExe.href);
      any = true;
    }

    if (data.androidApk?.available && data.androidApk.href) {
      apkBtn.hidden = false;
      apkBtn.setAttribute('href', data.androidApk.href);
      any = true;
    }

    if (data.release?.githubReleasePage) {
      releaseBtn.hidden = false;
      releaseBtn.setAttribute('href', data.release.githubReleasePage);
    }

    const tag = data.release?.tag ? ` (${data.release.tag})` : '';
    hint.textContent = any
      ? `Клиенты доступны через GitHub Releases${tag}.`
      : 'Укажите GITHUB_REPO на сервере и опубликуйте tag v* с assets, либо положите bootstrap в downloads/.';
  } catch {
    hint.textContent = 'Не удалось загрузить ссылки. Попробуйте позже.';
  }
}

void initDownloads();
