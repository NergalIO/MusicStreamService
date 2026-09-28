async function initDownloads() {
  const winBtn = document.getElementById('btn-windows');
  const apkBtn = document.getElementById('btn-android');
  const hint = document.getElementById('dl-hint');
  if (!winBtn || !apkBtn || !hint) return;

  try {
    const res = await fetch('site/downloads');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    let any = false;

    if (data.windows?.available) {
      winBtn.hidden = false;
      if (data.windows.href) winBtn.setAttribute('href', data.windows.href.replace(/^\//, ''));
      any = true;
    } else {
      winBtn.classList.add('disabled');
      winBtn.removeAttribute('hidden');
      winBtn.setAttribute('aria-disabled', 'true');
      winBtn.textContent = 'Windows — сборка скоро';
    }

    if (data.android?.available) {
      apkBtn.hidden = false;
      if (data.android.href) apkBtn.setAttribute('href', data.android.href.replace(/^\//, ''));
      any = true;
    } else {
      apkBtn.classList.add('disabled');
      apkBtn.removeAttribute('hidden');
      apkBtn.setAttribute('aria-disabled', 'true');
      apkBtn.textContent = 'Android — сборка скоро';
    }

    hint.textContent = any
      ? 'Актуальные установщики готовы к скачиванию.'
      : 'Установщики появятся после первой сборки на сервере.';
  } catch {
    hint.textContent = 'Не удалось проверить сборки. Попробуйте позже.';
  }
}

void initDownloads();
