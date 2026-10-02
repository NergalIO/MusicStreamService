const BASE = String(window.MSS_BASE || '').replace(/\/$/, '');
const api = (path) => `${BASE}${path.startsWith('/') ? path : `/${path}`}`;

const store = {
  get access() {
    return sessionStorage.getItem('mss_admin_access') || '';
  },
  set access(v) {
    sessionStorage.setItem('mss_admin_access', v);
  },
  get refresh() {
    return sessionStorage.getItem('mss_admin_refresh') || '';
  },
  set refresh(v) {
    sessionStorage.setItem('mss_admin_refresh', v);
  },
  clear() {
    sessionStorage.removeItem('mss_admin_access');
    sessionStorage.removeItem('mss_admin_refresh');
  },
};

let logTimer = 0;

function fmtBytes(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function fmtUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}ч ${m}м`;
}

function errMsg(text, fallback) {
  try {
    const j = JSON.parse(text);
    return j.message || j.error || fallback;
  } catch {
    return text || fallback;
  }
}

async function request(path, opts = {}, retry = true) {
  const res = await fetch(api(path), {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(store.access ? { Authorization: `Bearer ${store.access}` } : {}),
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  if (res.status === 401 && retry && store.refresh) {
    const ok = await refreshSession();
    if (ok) return request(path, opts, false);
  }
  if (!res.ok) throw new Error(errMsg(text, res.statusText));
  return text ? JSON.parse(text) : {};
}

async function refreshSession() {
  const res = await fetch(api('/auth/refresh'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: store.refresh }),
  });
  if (!res.ok) {
    store.clear();
    return false;
  }
  const data = await res.json();
  store.access = data.accessToken;
  return true;
}

function showLogin(msg) {
  document.getElementById('login-view').hidden = false;
  document.getElementById('app-view').hidden = true;
  const el = document.getElementById('login-error');
  if (msg) {
    el.hidden = false;
    el.textContent = msg;
  } else {
    el.hidden = true;
  }
  clearInterval(logTimer);
}

function showApp() {
  document.getElementById('login-view').hidden = true;
  document.getElementById('app-view').hidden = false;
}

function table(headers, rows) {
  if (!rows.length) return '<p class="hint">Пусто</p>';
  const head = headers.map((h) => `<th>${h}</th>`).join('');
  const body = rows.map((cols) => `<tr>${cols.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
  return `<div style="overflow:auto"><table class="dash-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

async function loadOverview() {
  const d = await request('/admin/overview');
  const cards = [
    ['Пользователи', d.users, `${d.verifiedUsers} с подтверждённой почтой`],
    ['Треки', d.tracks, d.storageBackend],
    ['Альбомы', d.albums, `${d.playlists} плейлистов`],
    ['Хранилище', fmtBytes(d.storageBytes), d.storageBackend],
    ['БД', d.dbOk ? 'ok' : 'нет', d.redisOk ? 'Redis ok' : 'Redis нет'],
    ['Uptime', fmtUptime(d.uptimeSec), `v${d.version}`],
    ['SMTP', d.smtp ? 'настроен' : 'нет', d.emailVerificationRequired ? 'OTP включён' : 'OTP выкл'],
    [
      'Очередь',
      d.queue ? d.queue.active + d.queue.wait : '—',
      d.queue ? `fail ${d.queue.failed}` : '',
    ],
  ];
  document.getElementById('overview-cards').innerHTML = cards
    .map(([k, v, s]) => `<div class="dash-stat"><span>${esc(k)}</span><b>${esc(v)}</b><span>${esc(s)}</span></div>`)
    .join('');
}

async function loadUsers() {
  const q = document.getElementById('user-q').value.trim();
  const d = await request(`/admin/users?limit=50&q=${encodeURIComponent(q)}`);
  document.getElementById('users-table').innerHTML = table(
    ['Email', 'Роль', 'Почта', 'Подписка', 'Создан', ''],
    d.items.map((u) => [
      esc(u.email),
      esc(u.role),
      u.emailVerifiedAt ? 'да' : 'нет',
      esc(u.subscription?.planCode ?? '—'),
      esc(fmtDate(u.createdAt)),
      `<div class="dash-actions">
        ${u.emailVerifiedAt ? '' : `<button data-act="verify" data-id="${u.id}">Подтвердить</button>`}
        ${u.role === 'admin' ? `<button data-act="user" data-id="${u.id}">Снять admin</button>` : `<button data-act="admin" data-id="${u.id}">Сделать admin</button>`}
        <button data-act="premium" data-id="${u.id}">Premium 30д</button>
        <button data-act="password" data-id="${u.id}">Пароль</button>
        <button class="danger" data-act="delete" data-id="${u.id}">Удалить</button>
      </div>`,
    ]),
  );
}

async function loadCatalog() {
  const q = document.getElementById('catalog-q').value.trim();
  const tracks = await request(`/admin/tracks?limit=40&q=${encodeURIComponent(q)}`);
  const albums = await request(`/admin/albums?limit=40&q=${encodeURIComponent(q)}`);
  document.getElementById('tracks-table').innerHTML = table(
    ['Название', 'Исполнитель', 'Статус', ''],
    tracks.items.map((t) => [
      esc(t.title),
      esc(t.artist),
      esc(t.status),
      `<div class="dash-actions"><button class="danger" data-kind="track" data-id="${t.id}">Удалить</button></div>`,
    ]),
  );
  document.getElementById('albums-table').innerHTML = table(
    ['Альбом', 'Исполнитель', 'Год', ''],
    albums.items.map((a) => [
      esc(a.title),
      esc(a.artist),
      a.year ?? '—',
      `<div class="dash-actions"><button class="danger" data-kind="album" data-id="${a.id}">Удалить</button></div>`,
    ]),
  );
}

async function loadLogs() {
  const d = await request('/admin/logs?limit=250');
  const el = document.getElementById('logs-view');
  el.textContent = d.items
    .map((l) => `${l.t.replace('T', ' ').slice(0, 19)}  ${l.level.padEnd(5)}  ${l.msg}`)
    .join('\n');
  el.scrollTop = el.scrollHeight;
}

async function loadServer() {
  const d = await request('/admin/config');
  const smtp = d.smtp?.configured ? `${d.smtp.host}:${d.smtp.port}` : 'не настроен';
  document.getElementById('server-info').innerHTML = `
    <p><span class="${d.smtp?.configured ? 'dash-ok' : 'dash-bad'}">SMTP: ${esc(smtp)}</span></p>
    <p>From: ${esc(d.smtp?.from)}</p>
    <p>URL: ${esc(d.publicUrl)}</p>
    <p>Путь: ${esc(d.basePath)}</p>
    <p>Окружение: ${esc(d.nodeEnv)} · v${esc(d.version)}</p>
    <p>Хранилище: ${esc(d.storageBackend)}</p>
    <p>Подтверждение почты: ${d.emailVerificationRequired ? 'включено' : 'выключено'}</p>
  `;
}

const loaders = {
  overview: loadOverview,
  users: loadUsers,
  catalog: loadCatalog,
  logs: loadLogs,
  server: loadServer,
};

function setTab(name) {
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  document.querySelectorAll('[data-panel]').forEach((p) => {
    p.hidden = p.dataset.panel !== name;
  });
  clearInterval(logTimer);
  if (name === 'logs') logTimer = setInterval(() => loadLogs().catch(() => {}), 5000);
  loaders[name]?.().catch((e) => alert(e.message));
}

async function boot() {
  if (!store.access) {
    showLogin();
    return;
  }
  try {
    const me = await request('/admin/me');
    document.getElementById('me-email').textContent = me.email;
    showApp();
    setTab('overview');
  } catch (e) {
    store.clear();
    showLogin(e.message);
  }
}

document.getElementById('login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const data = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (data.needsVerification) throw new Error('Сначала подтвердите почту в клиенте, затем войдите в панель');
    store.access = data.accessToken;
    store.refresh = data.refreshToken;
    const me = await request('/admin/me');
    document.getElementById('me-email').textContent = me.email;
    showApp();
    setTab('overview');
  } catch (e) {
    store.clear();
    showLogin(e.message);
  }
});

document.getElementById('logout').addEventListener('click', () => {
  store.clear();
  showLogin();
});

document.querySelectorAll('[data-tab]').forEach((b) => {
  b.addEventListener('click', () => setTab(b.dataset.tab));
});

document.getElementById('user-search').addEventListener('click', () => loadUsers().catch((e) => alert(e.message)));
document.getElementById('catalog-search').addEventListener('click', () => loadCatalog().catch((e) => alert(e.message)));

document.getElementById('user-create').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  try {
    await request('/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email: fd.get('email'),
        password: fd.get('password'),
        role: fd.get('role'),
      }),
    });
    ev.target.reset();
    await loadUsers();
  } catch (e) {
    alert(e.message);
  }
});

document.getElementById('users-table').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  try {
    if (act === 'delete' && !confirm('Удалить пользователя и его данные?')) return;
    if (act === 'password') {
      const password = prompt('Новый пароль (от 8 символов)');
      if (!password) return;
      await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ password }) });
    } else if (act === 'delete') {
      await request(`/admin/users/${id}`, { method: 'DELETE' });
    } else if (act === 'verify') {
      await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ emailVerified: true }) });
    } else if (act === 'admin') {
      await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) });
    } else if (act === 'user') {
      await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: 'user' }) });
    } else if (act === 'premium') {
      await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ plan: 'premium', planDays: 30 }) });
    }
    await loadUsers();
  } catch (e) {
    alert(e.message);
  }
});

document.getElementById('tracks-table').addEventListener('click', onCatalogDelete);
document.getElementById('albums-table').addEventListener('click', onCatalogDelete);

async function onCatalogDelete(ev) {
  const btn = ev.target.closest('button[data-kind]');
  if (!btn || !confirm('Удалить?')) return;
  const path = btn.dataset.kind === 'track' ? `/admin/tracks/${btn.dataset.id}` : `/admin/albums/${btn.dataset.id}`;
  try {
    await request(path, { method: 'DELETE' });
    await loadCatalog();
  } catch (e) {
    alert(e.message);
  }
}

document.getElementById('mail-test').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const status = document.getElementById('mail-status');
  status.textContent = 'Отправка…';
  try {
    const to = document.getElementById('mail-to').value.trim();
    const d = await request('/admin/mail-test', { method: 'POST', body: JSON.stringify(to ? { to } : {}) });
    status.textContent = `Отправлено на ${d.to}`;
  } catch (e) {
    status.textContent = e.message;
  }
});

boot();
