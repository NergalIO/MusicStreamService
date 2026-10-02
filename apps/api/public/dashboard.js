const BASE = String(window.MSS_BASE || '').replace(/\/$/, '');
const api = (path) => `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
const PAGE = 30;
const TITLES = {
  overview: ['Обзор', 'Состояние сервера'],
  users: ['Пользователи', 'Роли, почта, подписки'],
  catalog: ['Каталог', 'Треки и альбомы MSS'],
  logs: ['Логи', 'События этого процесса API'],
  server: ['Сервер', 'Конфигурация без секретов'],
};

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

const state = {
  me: null,
  tab: 'overview',
  usersOffset: 0,
  catalogKind: 'tracks',
  catalogOffset: 0,
  logLevel: 'all',
  logQuery: '',
  logTimer: 0,
};

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

function fmtDur(ms) {
  if (!ms) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function errMsg(text, fallback) {
  try {
    const j = JSON.parse(text);
    return j.message || j.error || fallback;
  } catch {
    return text || fallback;
  }
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;');
}

function toast(msg, err = false) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `dash-toast${err ? ' err' : ''}`;
  el.textContent = msg;
  box.append(el);
  setTimeout(() => el.remove(), 4200);
}

function modal({ title, text, fields, okLabel, danger }) {
  return new Promise((resolve) => {
    const root = document.getElementById('modal');
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-text').textContent = text || '';
    const fieldsEl = document.getElementById('modal-fields');
    fieldsEl.innerHTML = (fields || [])
      .map(
        (f) =>
          `<label class="dash-form">${esc(f.label)}<input id="modal-f-${esc(f.name)}" type="${esc(f.type || 'text')}" ${f.required ? 'required' : ''} minlength="${f.minlength || 0}" /></label>`,
      )
      .join('');
    const ok = document.getElementById('modal-ok');
    ok.textContent = okLabel || 'ОК';
    ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    root.hidden = false;
    const done = (value) => {
      root.hidden = true;
      document.getElementById('modal-cancel').onclick = null;
      ok.onclick = null;
      root.onclick = null;
      resolve(value);
    };
    document.getElementById('modal-cancel').onclick = () => done(null);
    root.onclick = (ev) => {
      if (ev.target === root) done(null);
    };
    ok.onclick = () => {
      if (!fields?.length) return done(true);
      const data = {};
      for (const f of fields) {
        data[f.name] = document.getElementById(`modal-f-${f.name}`).value;
        if (f.required && !data[f.name]) return toast('Заполните поле', true);
        if (f.minlength && data[f.name].length < f.minlength) return toast(`Минимум ${f.minlength} символов`, true);
      }
      done(data);
    };
  });
}

async function request(path, opts = {}, retry = true) {
  const headers = {
    ...(store.access ? { Authorization: `Bearer ${store.access}` } : {}),
    ...(opts.headers || {}),
  };
  if (opts.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(api(path), { ...opts, headers });
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
  closeDrawer();
  const el = document.getElementById('login-error');
  el.hidden = !msg;
  el.textContent = msg || '';
  clearInterval(state.logTimer);
  const saved = localStorage.getItem('mss_admin_email');
  if (saved && !document.getElementById('login-email').value) {
    document.getElementById('login-email').value = saved;
  }
}

function showApp() {
  document.getElementById('login-view').hidden = true;
  document.getElementById('app-view').hidden = false;
}

function pill(ok, label) {
  return `<span class="dash-pill"><i class="dash-dot ${ok ? 'ok' : 'bad'}"></i>${esc(label)}</span>`;
}

function badge(text, cls) {
  return `<span class="dash-badge ${cls || ''}">${esc(text)}</span>`;
}

function empty(text) {
  return `<div class="dash-empty">${esc(text)}</div>`;
}

function skel() {
  return `<div class="dash-skel">Загрузка…</div>`;
}

function pager(id, total, offset, onPrev, onNext) {
  const el = document.getElementById(id);
  if (total <= PAGE) {
    el.innerHTML = total ? `<span class="hint">${total}</span>` : '';
    return;
  }
  el.innerHTML = `
    <button type="button" class="btn btn-ghost" ${offset <= 0 ? 'disabled' : ''} data-p="prev">Назад</button>
    <span class="hint">${offset + 1}–${Math.min(offset + PAGE, total)} из ${total}</span>
    <button type="button" class="btn btn-ghost" ${offset + PAGE >= total ? 'disabled' : ''} data-p="next">Дальше</button>`;
  el.querySelector('[data-p="prev"]')?.addEventListener('click', onPrev);
  el.querySelector('[data-p="next"]')?.addEventListener('click', onNext);
}

function table(headers, rows, { emptyText, rowAttr }) {
  if (!rows.length) return empty(emptyText || 'Ничего нет');
  const head = headers.map((h) => `<th>${h}</th>`).join('');
  const body = rows
    .map(
      (r) =>
        `<tr ${rowAttr ? rowAttr(r.raw) : ''}>${r.cols.map((c) => `<td>${c}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<div class="dash-table-wrap"><table class="dash-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

async function loadOverview() {
  const cards = document.getElementById('overview-cards');
  cards.innerHTML = skel();
  const d = await request('/admin/overview');
  document.getElementById('health-dots').innerHTML = `
    <i class="dash-dot ${d.dbOk ? 'ok' : 'bad'}" title="БД"></i>
    <i class="dash-dot ${d.redisOk ? 'ok' : 'bad'}" title="Redis"></i>
    <i class="dash-dot ${d.smtp ? 'ok' : 'bad'}" title="SMTP"></i>`;
  document.getElementById('top-meta').textContent = `v${d.version} · ${fmtUptime(d.uptimeSec)}`;
  document.getElementById('overview-health').innerHTML = [
    pill(d.dbOk, d.dbOk ? 'База данных' : 'БД недоступна'),
    pill(d.redisOk, d.redisOk ? 'Redis' : 'Redis нет'),
    pill(d.smtp, d.smtp ? 'SMTP' : 'SMTP не настроен'),
    pill(d.emailVerificationRequired, d.emailVerificationRequired ? 'OTP включён' : 'OTP выкл'),
  ].join('');
  const stats = [
    ['Пользователи', d.users, `${d.unverifiedUsers || 0} без подтверждения`],
    ['Почта ок', d.verifiedUsers, 'подтвердили email'],
    ['Треки', d.tracks, d.storageBackend],
    ['Альбомы', d.albums, `${d.playlists} плейлистов`],
    ['Хранилище', fmtBytes(d.storageBytes), d.storageBackend],
    ['Аптайм', fmtUptime(d.uptimeSec), `v${d.version}`],
  ];
  cards.innerHTML = stats
    .map(([k, v, s]) => `<div class="dash-stat"><span>${esc(k)}</span><b>${esc(v)}</b><span>${esc(s)}</span></div>`)
    .join('');
  const q = d.queue || {};
  document.getElementById('overview-queue').innerHTML = d.queue
    ? `<h2>Очередь транскода</h2>
       <div class="dash-pills">
         ${pill(true, `ожидают ${q.wait ?? 0}`)}
         ${pill(true, `в работе ${q.active ?? 0}`)}
         ${pill(true, `отложены ${q.delayed ?? 0}`)}
         ${pill(!(q.failed > 0), `ошибки ${q.failed ?? 0}`)}
         ${pill(true, `готово ${q.completed ?? 0}`)}
       </div>`
    : `<h2>Очередь транскода</h2><p class="dash-bad">Redis недоступен</p>`;
}

async function loadUsers() {
  const box = document.getElementById('users-table');
  box.innerHTML = skel();
  const q = document.getElementById('user-q').value.trim();
  const d = await request(`/admin/users?limit=${PAGE}&offset=${state.usersOffset}&q=${encodeURIComponent(q)}`);
  const meId = state.me?.id;
  box.innerHTML = table(
    ['Email', 'Статус', 'Активность', 'Контент'],
    d.items.map((u) => ({
      raw: u,
      cols: [
        `${esc(u.email)}${u.id === meId ? ' <span class="dash-badge admin">вы</span>' : ''}`,
        `${u.role === 'admin' ? badge('admin', 'admin') : badge('user')}
         ${u.emailVerifiedAt ? badge('почта', 'ok') : badge('не подтверждён', 'warn')}
         ${badge(u.subscription?.planCode || 'free', u.subscription?.planCode === 'premium' ? 'ok' : '')}`,
        `${esc(u.lastSeenAt ? fmtDate(u.lastSeenAt) : 'не заходил')}<div class="hint">${u.deviceCount} устр.</div>`,
        `${u.trackCount} трек. · ${u.albumCount} альб.`,
      ],
    })),
    {
      emptyText: 'Пользователей нет',
      rowAttr: (u) => `data-user="${u.id}" class="${u.id === meId ? 'is-you' : ''}"`,
    },
  );
  pager(
    'users-pager',
    d.total,
    state.usersOffset,
    () => {
      state.usersOffset = Math.max(0, state.usersOffset - PAGE);
      loadUsers().catch((e) => toast(e.message, true));
    },
    () => {
      state.usersOffset += PAGE;
      loadUsers().catch((e) => toast(e.message, true));
    },
  );
}

async function openUser(id) {
  const drawer = document.getElementById('drawer');
  const body = document.getElementById('drawer-body');
  document.getElementById('drawer-backdrop').hidden = false;
  drawer.hidden = false;
  body.innerHTML = skel();
  const u = await request(`/admin/users/${id}`);
  document.getElementById('drawer-title').textContent = u.email;
  const self = u.id === state.me?.id;
  body.innerHTML = `
    <dl>
      <dt>Роль</dt><dd>${esc(u.role)}</dd>
      <dt>Почта</dt><dd>${u.emailVerifiedAt ? `подтверждена ${esc(fmtDate(u.emailVerifiedAt))}` : 'не подтверждена'}</dd>
      <dt>Подписка</dt><dd>${esc(u.subscription?.planName || u.subscription?.planCode || '—')}${u.subscription?.endsAt ? ` · до ${esc(fmtDate(u.subscription.endsAt))}` : ''}</dd>
      <dt>Создан</dt><dd>${esc(fmtDate(u.createdAt))}</dd>
      <dt>Контент</dt><dd>${u.trackCount} треков, ${u.albumCount} альбомов, ${u.playlistCount} плейлистов</dd>
      <dt>Устройства</dt>
      <dd>${
        u.devices?.length
          ? u.devices.map((d) => `${esc(d.name)} · ${esc(fmtDate(d.lastSeenAt))}`).join('<br>')
          : 'нет'
      }</dd>
    </dl>
    <div class="dash-actions">
      ${u.emailVerifiedAt ? '' : `<button type="button" class="btn btn-secondary" data-act="verify" data-id="${u.id}">Подтвердить почту</button>`}
      ${
        u.role === 'admin'
          ? `<button type="button" class="btn btn-secondary" data-act="user" data-id="${u.id}">Снять admin</button>`
          : `<button type="button" class="btn btn-secondary" data-act="admin" data-id="${u.id}">Сделать admin</button>`
      }
      <button type="button" class="btn btn-secondary" data-act="premium" data-id="${u.id}">Premium 30 дней</button>
      <button type="button" class="btn btn-secondary" data-act="password" data-id="${u.id}">Сменить пароль</button>
      ${self ? '' : `<button type="button" class="btn btn-danger" data-act="delete" data-id="${u.id}" data-email="${esc(u.email)}">Удалить</button>`}
    </div>`;
}

function closeDrawer() {
  document.getElementById('drawer').hidden = true;
  document.getElementById('drawer-backdrop').hidden = true;
}

async function userAction(act, id, email) {
  if (act === 'delete') {
    const ok = await modal({
      title: 'Удалить пользователя?',
      text: `Будут удалены данные ${email || id}: треки, альбомы, сессии.`,
      okLabel: 'Удалить',
      danger: true,
    });
    if (!ok) return;
    await request(`/admin/users/${id}`, { method: 'DELETE' });
    toast('Пользователь удалён');
    closeDrawer();
  } else if (act === 'password') {
    const data = await modal({
      title: 'Новый пароль',
      text: 'Сессии пользователя будут сброшены.',
      fields: [{ name: 'password', label: 'Пароль', type: 'password', required: true, minlength: 8 }],
      okLabel: 'Сохранить',
    });
    if (!data) return;
    await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ password: data.password }) });
    toast('Пароль обновлён');
  } else if (act === 'verify') {
    await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ emailVerified: true }) });
    toast('Почта подтверждена');
  } else if (act === 'admin') {
    await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: 'admin' }) });
    toast('Роль: admin');
  } else if (act === 'user') {
    await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ role: 'user' }) });
    toast('Роль: user');
  } else if (act === 'premium') {
    await request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify({ plan: 'premium', planDays: 30 }) });
    toast('Premium на 30 дней');
  }
  await loadUsers();
  if (!document.getElementById('drawer').hidden && act !== 'delete') await openUser(id);
}

async function loadCatalog() {
  const box = document.getElementById('catalog-table');
  box.innerHTML = skel();
  const q = document.getElementById('catalog-q').value.trim();
  const kind = state.catalogKind;
  const d = await request(`/admin/${kind}?limit=${PAGE}&offset=${state.catalogOffset}&q=${encodeURIComponent(q)}`);
  if (kind === 'tracks') {
    box.innerHTML = table(
      ['Название', 'Исполнитель', 'Статус', 'Длительность', ''],
      d.items.map((t) => ({
        raw: t,
        cols: [
          esc(t.title),
          esc(t.artist),
          badge(t.status, t.status === 'ready' ? 'ok' : 'warn'),
          fmtDur(t.durationMs),
          `<button type="button" class="btn btn-ghost" data-kind="track" data-id="${t.id}" data-title="${esc(t.title)}">Удалить</button>`,
        ],
      })),
      { emptyText: 'Треков нет' },
    );
  } else {
    box.innerHTML = table(
      ['Альбом', 'Исполнитель', 'Год', ''],
      d.items.map((a) => ({
        raw: a,
        cols: [
          esc(a.title),
          esc(a.artist),
          a.year ?? '—',
          `<button type="button" class="btn btn-ghost" data-kind="album" data-id="${a.id}" data-title="${esc(a.title)}">Удалить</button>`,
        ],
      })),
      { emptyText: 'Альбомов нет' },
    );
  }
  pager(
    'catalog-pager',
    d.total,
    state.catalogOffset,
    () => {
      state.catalogOffset = Math.max(0, state.catalogOffset - PAGE);
      loadCatalog().catch((e) => toast(e.message, true));
    },
    () => {
      state.catalogOffset += PAGE;
      loadCatalog().catch((e) => toast(e.message, true));
    },
  );
}

async function loadLogs() {
  const d = await request('/admin/logs?limit=250');
  const q = state.logQuery.toLowerCase();
  const items = d.items.filter((l) => {
    if (state.logLevel !== 'all' && l.level !== state.logLevel) return false;
    if (q && !`${l.msg} ${l.level}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const el = document.getElementById('logs-view');
  if (!items.length) {
    el.innerHTML = empty('Нет записей по фильтру');
    return;
  }
  el.innerHTML = items
    .map(
      (l) =>
        `<div class="dash-log"><span>${esc(l.t.replace('T', ' ').slice(0, 19))}</span><span class="lvl-${esc(l.level)}">${esc(l.level)}</span><span>${esc(l.msg)}</span></div>`,
    )
    .join('');
  el.scrollTop = el.scrollHeight;
}

async function loadServer() {
  const d = await request('/admin/config');
  const rows = [
    ['Публичный URL', d.publicUrl, d.publicUrl],
    ['Путь API', d.basePath],
    ['Версия', d.version],
    ['Окружение', d.nodeEnv],
    ['Хранилище', d.storageBackend],
    ['SMTP', d.smtp?.configured ? `${d.smtp.host}:${d.smtp.port}` : 'не настроен'],
    ['SMTP from', d.smtp?.from],
    ['SMTP user', d.smtp?.user || '—'],
    ['Подтверждение почты', d.emailVerificationRequired ? 'включено' : 'выключено'],
    ['TTL кода, мин', d.emailVerificationTtlMin],
  ];
  document.getElementById('server-info').innerHTML = rows
    .map(
      ([k, v, copy]) =>
        `<div class="dash-kv"><span>${esc(k)}</span><b class="${k === 'SMTP' && !d.smtp?.configured ? 'dash-bad' : ''}">${esc(v)}</b>${
          copy ? `<button type="button" class="btn btn-ghost copy" data-copy="${esc(copy)}">Копировать</button>` : ''
        }</div>`,
    )
    .join('');
}

const loaders = {
  overview: loadOverview,
  users: loadUsers,
  catalog: loadCatalog,
  logs: loadLogs,
  server: loadServer,
};

function setTab(name) {
  state.tab = name;
  const [title, sub] = TITLES[name];
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-sub').textContent = sub;
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === name));
  document.querySelectorAll('[data-panel]').forEach((p) => {
    p.hidden = p.dataset.panel !== name;
  });
  clearInterval(state.logTimer);
  if (name === 'logs') state.logTimer = setInterval(() => loadLogs().catch(() => {}), 5000);
  loaders[name]?.().catch((e) => toast(e.message, true));
}

async function boot() {
  const saved = localStorage.getItem('mss_admin_email');
  if (saved) document.getElementById('login-email').value = saved;
  if (!store.access) {
    showLogin();
    return;
  }
  try {
    state.me = await request('/admin/me');
    document.getElementById('me-email').textContent = state.me.email;
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
    localStorage.setItem('mss_admin_email', email);
    state.me = await request('/admin/me');
    document.getElementById('me-email').textContent = state.me.email;
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

document.getElementById('user-search').addEventListener('click', () => {
  state.usersOffset = 0;
  loadUsers().catch((e) => toast(e.message, true));
});
document.getElementById('user-q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    state.usersOffset = 0;
    loadUsers().catch((err) => toast(err.message, true));
  }
});

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
    toast('Пользователь создан');
    state.usersOffset = 0;
    await loadUsers();
  } catch (e) {
    toast(e.message, true);
  }
});

document.getElementById('users-table').addEventListener('click', (ev) => {
  const tr = ev.target.closest('tr[data-user]');
  if (tr) openUser(tr.dataset.user).catch((e) => toast(e.message, true));
});

document.getElementById('drawer-body').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  try {
    await userAction(btn.dataset.act, btn.dataset.id, btn.dataset.email);
  } catch (e) {
    toast(e.message, true);
  }
});

document.getElementById('drawer-close').addEventListener('click', closeDrawer);
document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!document.getElementById('modal').hidden) {
    document.getElementById('modal-cancel').click();
    return;
  }
  closeDrawer();
});

document.querySelectorAll('[data-cat]').forEach((b) => {
  b.addEventListener('click', () => {
    state.catalogKind = b.dataset.cat;
    state.catalogOffset = 0;
    document.querySelectorAll('[data-cat]').forEach((x) => x.classList.toggle('is-active', x === b));
    loadCatalog().catch((e) => toast(e.message, true));
  });
});

document.getElementById('catalog-search').addEventListener('click', () => {
  state.catalogOffset = 0;
  loadCatalog().catch((e) => toast(e.message, true));
});
document.getElementById('catalog-q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    state.catalogOffset = 0;
    loadCatalog().catch((err) => toast(err.message, true));
  }
});

document.getElementById('catalog-table').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('button[data-kind]');
  if (!btn) return;
  ev.stopPropagation();
  const ok = await modal({
    title: 'Удалить из каталога?',
    text: btn.dataset.title || btn.dataset.id,
    okLabel: 'Удалить',
    danger: true,
  });
  if (!ok) return;
  const path = btn.dataset.kind === 'track' ? `/admin/tracks/${btn.dataset.id}` : `/admin/albums/${btn.dataset.id}`;
  try {
    await request(path, { method: 'DELETE' });
    toast('Удалено');
    await loadCatalog();
  } catch (e) {
    toast(e.message, true);
  }
});

document.querySelectorAll('#log-levels [data-level]').forEach((b) => {
  b.addEventListener('click', () => {
    state.logLevel = b.dataset.level;
    document.querySelectorAll('#log-levels [data-level]').forEach((x) => x.classList.toggle('is-active', x === b));
    loadLogs().catch((e) => toast(e.message, true));
  });
});
document.getElementById('log-q').addEventListener('input', (e) => {
  state.logQuery = e.target.value;
  loadLogs().catch(() => {});
});

document.getElementById('server-info').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-copy]');
  if (!btn) return;
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    toast('Скопировано');
  } catch {
    toast('Не удалось скопировать', true);
  }
});

document.getElementById('mail-test').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    const to = document.getElementById('mail-to').value.trim();
    const d = await request('/admin/mail-test', { method: 'POST', body: JSON.stringify(to ? { to } : {}) });
    toast(`Письмо отправлено на ${d.to}`);
  } catch (e) {
    toast(e.message, true);
  }
});

boot();
