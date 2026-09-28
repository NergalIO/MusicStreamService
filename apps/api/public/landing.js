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

function closeMenu(menu, trigger) {
  menu.hidden = true;
  trigger.setAttribute('aria-expanded', 'false');
}

function openMenu(menu, trigger) {
  menu.hidden = false;
  trigger.setAttribute('aria-expanded', 'true');
}

function toggleMenu(menu, trigger) {
  if (menu.hidden) openMenu(menu, trigger);
  else closeMenu(menu, trigger);
}

async function initDownloads() {
  const section = document.querySelector('.downloads');
  const trigger = document.getElementById('btn-download');
  const menu = document.getElementById('download-menu');
  const hint = document.getElementById('dl-hint');
  if (!trigger || !menu || !hint) return;

  section?.classList.add('is-loading');
  hint.hidden = true;

  const items = [];

  try {
    const res = await fetch(apiUrl('site/downloads'));
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();

    if (data.windowsExe?.available && data.windowsExe.href) {
      items.push({
        label: 'Windows',
        subtitle: 'Установщик .exe',
        href: data.windowsExe.href,
      });
    }

    if (data.androidApk?.available && data.androidApk.href) {
      items.push({
        label: 'Android',
        subtitle: 'APK для sideload',
        href: data.androidApk.href,
      });
    }

    menu.replaceChildren();
    for (const item of items) {
      const link = document.createElement('a');
      link.className = 'download-menu-item';
      link.role = 'menuitem';
      link.href = item.href;
      link.rel = 'noopener';
      link.innerHTML = `<span class="download-menu-label">${item.label}</span><span class="download-menu-sub">${item.subtitle}</span>`;
      link.addEventListener('click', () => closeMenu(menu, trigger));
      menu.appendChild(link);
    }

    if (items.length === 0) {
      trigger.disabled = true;
      hint.hidden = false;
      hint.textContent =
        'Пока нет готовых установщиков. Опубликуйте GitHub Release (tag v*) с .exe и APK или проверьте GITHUB_REPO на сервере.';
    } else {
      trigger.disabled = false;
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleMenu(menu, trigger);
      });
      document.addEventListener('click', () => closeMenu(menu, trigger));
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeMenu(menu, trigger);
      });
    }
  } catch {
    trigger.disabled = true;
    hint.hidden = false;
    hint.textContent = 'Не удалось загрузить ссылки. Проверьте API и обновите страницу.';
  } finally {
    section?.classList.remove('is-loading');
  }
}

stripEmptyHash();
void initDownloads();
