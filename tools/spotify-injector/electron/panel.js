const out = document.getElementById("out");
const statusEl = document.getElementById("status");
const apiEl = document.getElementById("api");

let apiBase = "http://127.0.0.1:3939";

function setStatus(ok, text) {
  statusEl.textContent = text;
  statusEl.className = `badge ${ok === true ? "ok" : ok === false ? "bad" : "muted"}`;
}

function show(value) {
  out.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function call(path, init) {
  const res = await fetch(`${apiBase}${path}`, {
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function refreshHealth() {
  try {
    const { body } = await call("/health");
    const ok = Boolean(body?.ok);
    setStatus(ok, ok ? "bridge ok" : body?.tab ? "нет bridge" : "нет вкладки");
    return body;
  } catch {
    setStatus(false, "API offline");
    return null;
  }
}

const actions = {
  async health() {
    show(await call("/health"));
    await refreshHealth();
  },
  async state() {
    show(await call("/state"));
  },
  async auth() {
    show(await call("/auth"));
  },
  async "like-get"() {
    show(await call("/like"));
  },
  async "like-post"() {
    show(await call("/like", { method: "POST", body: "{}" }));
  },
  async "like-unlike"() {
    show(await call("/like", { method: "POST", body: JSON.stringify({ liked: false }) }));
  },
  clear() {
    out.textContent = "";
  },
};

document.querySelector("nav")?.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-action]");
  if (!btn) return;
  const action = actions[btn.dataset.action];
  if (!action) return;
  void action().catch((err) => show(String(err)));
});

window.electronPanel?.onReady?.((info) => {
  if (info?.api) {
    apiBase = info.api;
    apiEl.textContent = apiBase;
  }
  void refreshHealth();
  setInterval(() => {
    void refreshHealth();
  }, 2000);
});

apiEl.textContent = apiBase;
void refreshHealth();
setInterval(() => {
  void refreshHealth();
}, 2000);
