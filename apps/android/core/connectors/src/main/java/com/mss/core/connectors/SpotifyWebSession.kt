package com.mss.core.connectors

import android.annotation.SuppressLint
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.mss.core.datastore.TokenVault
import javax.inject.Inject
import javax.inject.Singleton
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

data class SpotifyWebHeaders(
    val authorization: String,
    val clientToken: String,
    val appVersion: String = "",
)

data class SpotifyDevice(
    val name: String,
    val active: Boolean,
    val local: Boolean,
)

data class SpotifyDomState(
    val ready: Boolean = false,
    val playing: Boolean = false,
    val ad: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val title: String = "",
)

@Singleton
class SpotifyWebSession @Inject constructor(
    private val vault: TokenVault,
) {
    private val main = Handler(Looper.getMainLooper())
    private var webView: WebView? = null

    private val _loggedIn = MutableStateFlow(false)
    val loggedIn: StateFlow<Boolean> = _loggedIn

    private val _dom = MutableStateFlow(SpotifyDomState())
    val dom: StateFlow<SpotifyDomState> = _dom

    private val _remoteDevice = MutableStateFlow<String?>(null)
    val remoteDevice: StateFlow<String?> = _remoteDevice

    @Volatile var headers: SpotifyWebHeaders? = null
        private set

    private val _visibleForLogin = MutableStateFlow(false)
    val visibleForLogin: StateFlow<Boolean> = _visibleForLogin

    @Volatile private var hashes: Map<String, String> = emptyMap()
    private var loginAgent = false
    private val httpIds = AtomicInteger()
    private val httpWaiters = ConcurrentHashMap<String, CompletableDeferred<Pair<Int, String>>>()
    private val deviceWaiters = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val playWaiters = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    private val pageMutex = Mutex()

    init {
        runCatching {
            CookieManager.getInstance().setAcceptCookie(true)
            restorePersistedCookies()
            CookieManager.getInstance().flush()
        }
        if (hasPersistedSession() || hasLoginCookies()) _loggedIn.value = true
    }

    fun hasPersistedSession(): Boolean = vault.get(FLAG_KEY) == "1"

    fun isReady(): Boolean = webView != null && _loggedIn.value

    fun operationHash(name: String): String? = hashes[name]

    fun invalidateHashes() {
        hashes = emptyMap()
        injectHelpers()
        eval(SCAN_OPERATIONS)
    }

    fun invalidateHeaders() {
        headers = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    fun attach(view: WebView) {
        if (webView === view) return
        webView = view
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true)
        view.settings.javaScriptEnabled = true
        view.settings.domStorageEnabled = true
        view.settings.mediaPlaybackRequiresUserGesture = false
        view.settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        view.settings.useWideViewPort = true
        view.settings.loadWithOverviewMode = false
        view.settings.setSupportZoom(false)
        view.settings.builtInZoomControls = false
        view.settings.displayZoomControls = false
        view.settings.userAgentString = DESKTOP_UA
        view.setBackgroundColor(android.graphics.Color.TRANSPARENT)
        view.setLayerType(WebView.LAYER_TYPE_NONE, null)
        view.isHorizontalScrollBarEnabled = false
        view.addJavascriptInterface(JsBridge(), "MssSpotify")
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = false

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): android.webkit.WebResourceResponse? {
                val h = request?.requestHeaders ?: return null
                val auth = h.entries.find { it.key.equals("authorization", true) }?.value
                val client = h.entries.find { it.key.equals("client-token", true) }?.value
                val ver = h.entries.find { it.key.equals("spotify-app-version", true) }?.value
                if (auth?.startsWith("Bearer ") == true && !client.isNullOrBlank()) {
                    headers = SpotifyWebHeaders(auth, client, ver.orEmpty())
                    if (!_loggedIn.value) markLoggedIn()
                }
                return null
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (hasLoginCookies()) markLoggedIn()
                if (loginAgent) eval(FIT_MOBILE)
                injectHelpers()
                if (_loggedIn.value && !loginAgent) eval(SCAN_OPERATIONS)
            }
        }
        restorePersistedCookies()
        if (hasLoginCookies() || hasPersistedSession()) markLoggedIn()
        view.loadUrl(HOME)
    }

    fun showLogin() {
        _visibleForLogin.value = true
        loginAgent = true
        main.post {
            val view = webView ?: return@post
            view.settings.userAgentString = DESKTOP_UA
            view.settings.loadWithOverviewMode = false
            eval(FIT_MOBILE)
            view.loadUrl(LOGIN_URL)
        }
    }

    fun hideLogin() {
        _visibleForLogin.value = false
        if (!loginAgent) return
        loginAgent = false
        ensurePlayer()
    }

    fun ensurePlayer() {
        main.post {
            val view = webView ?: return@post
            view.settings.userAgentString = DESKTOP_UA
            val url = view.url.orEmpty()
            if (url.isBlank() || url.contains("accounts.spotify.com") || url == "about:blank") {
                view.loadUrl(HOME)
            } else if (_loggedIn.value) {
                eval(SCAN_OPERATIONS)
            }
        }
    }

    suspend fun awaitHeaders(timeoutMs: Long = 20_000): SpotifyWebHeaders {
        headers?.let { if (hashes.isNotEmpty()) return it }
        ensurePlayer()
        val deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs
        var found: SpotifyWebHeaders? = headers
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            found = headers
            if (found != null && hashes.isNotEmpty()) return found
            delay(250)
        }
        return found ?: throw ConnectorException("Веб-плеер Spotify ещё загружается. Подождите пару секунд и повторите")
    }

    /**
     * Запрос из страницы open.spotify.com: те же cookie, TLS и client-token, что у веб-плеера.
     * Отдельный OkHttp Spotify отклоняет с 403.
     */
    suspend fun browserFetch(method: String, url: String, body: String? = null): Pair<Int, String> {
        if (webView == null) throw ConnectorException("Веб-плеер Spotify ещё не открыт")
        val headers = awaitHeaders()
        val id = httpIds.incrementAndGet().toString()
        val deferred = CompletableDeferred<Pair<Int, String>>()
        httpWaiters[id] = deferred
        val payload = JSONObject()
            .put("id", id)
            .put("method", method)
            .put("url", url)
            .put("authorization", headers.authorization)
            .put("clientToken", headers.clientToken)
            .put("appVersion", headers.appVersion)
            .put("body", body ?: JSONObject.NULL)
            .toString()
        eval(
            """
            (async () => {
              const req = JSON.parse(${JSONObject.quote(payload)});
              try {
                const res = await fetch(req.url, {
                  method: req.method,
                  credentials: 'include',
                  headers: {
                    accept: 'application/json',
                    'content-type': 'application/json;charset=UTF-8',
                    authorization: req.authorization,
                    'client-token': req.clientToken,
                    'spotify-app-version': req.appVersion,
                    'app-platform': 'WebPlayer',
                  },
                  body: req.body == null ? undefined : req.body,
                });
                MssSpotify.onHttp(req.id, res.status, await res.text());
              } catch (e) {
                MssSpotify.onHttp(req.id, 0, String(e && e.message || e));
              }
            })();
            """.trimIndent(),
        )
        return try {
            withTimeout(25_000) { deferred.await() }
        } finally {
            httpWaiters.remove(id)
        }
    }

    fun logout() {
        _visibleForLogin.value = false
        _loggedIn.value = false
        _remoteDevice.value = null
        loginAgent = false
        headers = null
        hashes = emptyMap()
        vault.delete(COOKIE_KEY)
        vault.delete(FLAG_KEY)
        main.post {
            clearSpotifyCookies()
            webView?.settings?.userAgentString = DESKTOP_UA
            webView?.loadUrl(HOME)
        }
    }

    private fun markLoggedIn() {
        persistCookies()
        if (!_loggedIn.value) _loggedIn.value = true
    }

    private fun hasLoginCookies(): Boolean {
        val cm = runCatching { CookieManager.getInstance() }.getOrNull() ?: return false
        return SpotifyCookies.URLS.any { url -> SpotifyCookies.headerLooksLoggedIn(cm.getCookie(url)) }
    }

    private fun persistCookies() {
        vault.set(FLAG_KEY, "1")
        val cm = runCatching { CookieManager.getInstance() }.getOrNull() ?: return
        val obj = JSONObject()
        for (url in SpotifyCookies.URLS) {
            val header = cm.getCookie(url) ?: continue
            if (header.isNotBlank()) obj.put(url, header)
        }
        if (obj.length() > 0) vault.set(COOKIE_KEY, obj.toString())
        runCatching { cm.flush() }
    }

    private fun restorePersistedCookies() {
        val raw = vault.get(COOKIE_KEY) ?: return
        val cm = runCatching { CookieManager.getInstance() }.getOrNull() ?: return
        val obj = runCatching { JSONObject(raw) }.getOrNull() ?: return
        obj.keys().forEach { url ->
            obj.optString(url).split(';').forEach { part ->
                val cookie = part.trim()
                if (cookie.isNotEmpty()) cm.setCookie(url, cookie)
            }
        }
    }

    private fun clearSpotifyCookies() {
        val cm = CookieManager.getInstance()
        for (url in SpotifyCookies.URLS) {
            cm.getCookie(url)?.split(';')?.forEach { part ->
                val name = part.substringBefore('=').trim()
                if (name.isNotBlank()) cm.setCookie(url, "$name=; Max-Age=0; Path=/")
            }
        }
        cm.flush()
    }

    suspend fun play(trackId: String, positionMs: Long = 0) {
        pageMutex.withLock {
            val id = httpIds.incrementAndGet().toString()
            val done = CompletableDeferred<Unit>()
            playWaiters[id] = done
            eval(
                """
                (async () => {
                  try {
                    $HELPERS
                    const href = '/track/$trackId';
                    if (!location.pathname.includes('$trackId')) location.href = 'https://open.spotify.com' + href;
                    for (let i = 0; i < 80 && !q('[data-testid="control-button-playpause"]'); i++) await sleep(250);
                    const btn = q('[data-testid="control-button-playpause"]');
                    if (btn && !isPauseLabel(btn)) btn.click();
                    if ($positionMs > 0) {
                      const progress = q('[data-testid="playback-progressbar"] input[type="range"]');
                      if (progress) setRange(progress, $positionMs);
                    }
                    MssSpotify.onState(JSON.stringify(readState()));
                  } finally {
                    MssSpotify.onPlayDone('$id');
                  }
                })();
                """.trimIndent(),
            )
            withTimeoutOrNull(25_000) { done.await() }
            playWaiters.remove(id)
            runCatching { applyDevices(queryDevices("list", "")) }
        }
    }

    /** Открывает меню устройств веб-плеера и возвращает, занят ли аккаунт чужим устройством. */
    suspend fun refreshDevices() {
        if (!pageMutex.tryLock()) return
        try {
            if (_visibleForLogin.value || webView == null) return
            applyDevices(queryDevices("list", ""))
        } finally {
            pageMutex.unlock()
        }
    }

    suspend fun listDevices(): List<SpotifyDevice> {
        return pageMutex.withLock {
            val status = queryDevices("list", "")
            applyDevices(status)
            status.devices
        }
    }

    /** @return true, если выбрано это приложение (веб-плеер). */
    suspend fun selectDevice(name: String): Boolean {
        return pageMutex.withLock {
            val status = queryDevices("select", name)
            applyDevices(status)
            status.selectedLocal
        }
    }

    private fun applyDevices(status: DeviceQuery) {
        _remoteDevice.value = status.remoteName
    }

    private suspend fun queryDevices(action: String, target: String): DeviceQuery {
        if (webView == null) return DeviceQuery(null, emptyList(), false)
        val id = httpIds.incrementAndGet().toString()
        val done = CompletableDeferred<String>()
        deviceWaiters[id] = done
        eval(deviceScript(action, JSONObject.quote(target), id))
        val json = try {
            withTimeoutOrNull(8_000) { done.await() }
        } finally {
            deviceWaiters.remove(id)
        } ?: return DeviceQuery(_remoteDevice.value, emptyList(), false)
        val obj = runCatching { JSONObject(json) }.getOrNull()
            ?: return DeviceQuery(_remoteDevice.value, emptyList(), false)
        val err = obj.optString("error")
        if (err.isNotBlank()) throw ConnectorException(err)
        val remote = obj.opt("remoteName")
            ?.takeUnless { it == org.json.JSONObject.NULL }
            ?.toString()
            ?.takeIf { it.isNotBlank() && it != "null" }
        val arr = obj.optJSONArray("devices") ?: JSONArray()
        val devices = buildList {
            for (i in 0 until arr.length()) {
                val d = arr.optJSONObject(i) ?: continue
                val name = d.optString("name")
                if (name.isBlank()) continue
                add(SpotifyDevice(name, d.optBoolean("active"), d.optBoolean("local")))
            }
        }
        return DeviceQuery(remote, devices, obj.optBoolean("selectedLocal"))
    }

    private data class DeviceQuery(
        val remoteName: String?,
        val devices: List<SpotifyDevice>,
        val selectedLocal: Boolean,
    )

    fun pause() = eval("document.querySelector('[data-testid=\"control-button-playpause\"]')?.click()")

    fun resume() = playCurrent()

    fun seek(positionMs: Long) {
        eval(
            """
            (function(){ $HELPERS
              const progress = q('[data-testid="playback-progressbar"] input[type="range"]');
              if (progress) setRange(progress, $positionMs);
            })();
            """.trimIndent(),
        )
    }

    fun setVolume(volume: Float) {
        val pct = (volume * 100).toInt().coerceIn(0, 100)
        eval(
            """
            (function(){ $HELPERS
              const input = q('[data-testid="volume-bar"] input[type="range"]') || q('[aria-label*="Volume"] input');
              if (input) setRange(input, $pct);
            })();
            """.trimIndent(),
        )
    }

    fun pollState() {
        if (pageMutex.isLocked) return
        eval("MssSpotify.onState(JSON.stringify((function(){ $HELPERS return readState(); })()))")
    }

    private fun playCurrent() {
        eval(
            """
            (function(){ $HELPERS
              const btn = q('[data-testid="control-button-playpause"]');
              if (btn && !isPauseLabel(btn)) btn.click();
            })();
            """.trimIndent(),
        )
    }

    private fun injectHelpers() {
        eval("$HELPERS")
    }

    private fun eval(script: String) {
        val view = webView ?: return
        main.post { view.evaluateJavascript(script, null) }
    }

    inner class JsBridge {
        @JavascriptInterface
        fun onHashes(json: String) {
            val parsed = runCatching { org.json.JSONObject(json) }.getOrNull() ?: return
            val next = mutableMapOf<String, String>()
            parsed.keys().forEach { key -> next[key] = parsed.optString(key) }
            hashes = next
        }

        @JavascriptInterface
        fun onHttp(id: String, status: Int, body: String) {
            httpWaiters.remove(id)?.complete(status to body)
        }

        @JavascriptInterface
        fun onPlayDone(id: String) {
            playWaiters.remove(id)?.complete(Unit)
        }

        @JavascriptInterface
        fun onDeviceResult(id: String, json: String) {
            deviceWaiters.remove(id)?.complete(json)
        }

        @JavascriptInterface
        fun onState(json: String) {
            runCatching {
                val obj = org.json.JSONObject(json)
                _dom.value = SpotifyDomState(
                    ready = obj.optBoolean("ready"),
                    playing = obj.optBoolean("playing"),
                    ad = obj.optBoolean("ad"),
                    positionMs = obj.optLong("positionMs"),
                    durationMs = obj.optLong("durationMs"),
                    title = obj.optString("title"),
                )
            }
        }
    }

    companion object {
        private const val HOME = "https://open.spotify.com/"
        private const val COOKIE_KEY = "spotify_web_cookies"
        private const val FLAG_KEY = "spotify_web_logged_in"
        private const val DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
        private const val LOGIN_URL =
            "https://accounts.spotify.com/login?continue=https%3A%2F%2Fopen.spotify.com%2F"
        private const val FIT_MOBILE = """
          (function(){
            let m = document.querySelector('meta[name="viewport"]');
            if (!m) {
              m = document.createElement('meta');
              m.setAttribute('name', 'viewport');
              (document.head || document.documentElement).appendChild(m);
            }
            m.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1');
          })();
        """

        private const val HELPERS = """
          const q = (s) => document.querySelector(s);
          const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const isPauseLabel = (el) => /pause|пауз/i.test(el?.getAttribute('aria-label') || '');
          const AD_TITLE = /advertisement|реклама/i;
          const isAd = () => {
            if (q('[data-testid="ad-skip-button"], [data-testid="ad-cta-button"]')) return true;
            const title = (q('[data-testid="context-item-info-title"]')?.textContent || '').trim();
            return AD_TITLE.test(title);
          };
          const parseClock = (t) => (t || '').trim().split(':').reduce((acc, part) => acc * 60 + (Number(part) || 0), 0) * 1000;
          const setRange = (input, value) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
            setter.call(input, String(value));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          };
          const readState = () => {
            const button = q('[data-testid="control-button-playpause"]');
            const progress = q('[data-testid="playback-progressbar"] input[type="range"]');
            return {
              ready: !!button,
              title: (q('[data-testid="context-item-info-title"]')?.textContent || '').trim(),
              playing: isPauseLabel(button),
              ad: isAd(),
              positionMs: parseClock(q('[data-testid="playback-position"]')?.textContent),
              durationMs: Number(progress?.max) || parseClock(q('[data-testid="playback-duration"]')?.textContent),
            };
          };
        """

        private const val SCAN_OPERATIONS = """
          (async () => {
            const urls = new Set(
              [...document.querySelectorAll('script[src]')].map((s) => s.src)
                .concat(performance.getEntriesByType('resource').map((e) => e.name))
                .filter((u) => /\/cdn\/build\/web-player\/[^/]+\.js${'$'}/.test(u)),
            );
            const main = [...urls].find((u) => /\/web-player\.[0-9a-f]+\.js${'$'}/.test(u));
            if (!main) return;
            const mainText = await (await fetch(main)).text();
            const name = 'xpui-routes-search';
            const id = mainText.match(new RegExp('(\\d+):"' + name + '"'))?.[1];
            const hash = id && mainText.match(new RegExp('[,{]' + id + ':"([0-9a-f]{8})"'))?.[1];
            if (hash) urls.add(main.replace(/[^/]+${'$'}/, name + '.' + hash + '.js'));
            const ops = {};
            const re = /"([A-Za-z0-9_]+)","(?:query|mutation)","([0-9a-f]{64})"/g;
            for (const u of urls) {
              const text = u === main ? mainText : await fetch(u).then((r) => r.text()).catch(() => '');
              for (const m of text.matchAll(re)) if (!ops[m[1]]) ops[m[1]] = m[2];
            }
            MssSpotify.onHashes(JSON.stringify(ops));
          })();
        """

        private fun deviceScript(action: String, targetLiteral: String, id: String): String {
            return DEVICE_SCRIPT
                .replace("%%ACTION%%", action)
                .replace("%%TARGET%%", targetLiteral)
                .replace("%%ID%%", id)
        }

        private const val DEVICE_SCRIPT = """
          (async () => {
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const action = '%%ACTION%%';
            const target = %%TARGET%%;
            const doneId = '%%ID%%';
            const finish = (payload) => MssSpotify.onDeviceResult(doneId, JSON.stringify(payload));
            try {
              const IDLE = new Set([
                'connect to a device',
                'подключиться к устройству',
                'подключение к устройству',
                'conectar a un dispositivo',
                'connecter à un appareil',
                'mit einem gerät verbinden',
                'connetti a un dispositivo',
                'een apparaat verbinden',
                'połącz z urządzeniem',
                '连接到设备',
                '接続先のデバイス',
              ]);
              const isIdle = (label) => IDLE.has(String(label || '').trim().toLowerCase());
              const isLocal = (name) => {
                const n = String(name || '').toLowerCase();
                return n.includes('this web browser') || n.includes('этот веб-браузер') || n.includes('web player')
                  || n.includes('веб-плеер') || n.includes('этот браузер') || n.includes('this computer') || n.includes('этот компьютер');
              };
              const listeningName = (text) => {
                const t = String(text || '').replace(/\s+/g, ' ').trim();
                const lower = t.toLowerCase();
                const marks = ['listening on ', 'playing on ', 'слушаете на ', 'воспроизводится на ', 'воспроизведение на ', 'играет на '];
                for (const mark of marks) {
                  const i = lower.indexOf(mark);
                  if (i >= 0) return t.slice(i + mark.length).trim();
                }
                return '';
              };
              const connectButton = () => {
                const direct = document.querySelector('[data-testid="connect-device-picker"], [data-testid="device-picker-icon-button"], [data-testid="control-button-connect"]');
                if (direct) return direct;
                return [...document.querySelectorAll('button')].find((b) => isIdle(b.getAttribute('aria-label') || '')) || null;
              };
              const looksLikeDevice = (name) => {
                if (!name || name.length > 48) return false;
                if (isLocal(name) || isIdle(name)) return isLocal(name);
                if (/english|afrikaans|amharic|azerbaijani|bulgarian|bhojpuri|bengali|bosnian|catalan|czech|danish|greek|spanish|french|german|italian|portuguese|russian|hindi|japanese|korean|chinese/i.test(name)) return false;
                return true;
              };
              const rowActive = (b) => {
                const cls = typeof b.className === 'string' ? b.className : '';
                return b.getAttribute('aria-checked') === 'true' || b.getAttribute('aria-selected') === 'true'
                  || b.getAttribute('aria-pressed') === 'true' || cls.split(/\s+/).includes('active');
              };
              const rowName = (b) => String(b.innerText || b.getAttribute('aria-label') || '').split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
              const parseRoot = (root) => {
                const opener = connectButton();
                const buttons = [...root.querySelectorAll('[data-testid="device-picker-item"], button, [role="menuitemcheckbox"], [role="menuitem"], [role="option"]')];
                const devices = [];
                const seen = new Set();
                for (const b of buttons) {
                  if (b === opener) continue;
                  const name = rowName(b);
                  if (!name || name.length > 80 || isIdle(name) || seen.has(name)) continue;
                  seen.add(name);
                  devices.push({ name, active: rowActive(b), local: isLocal(name), el: b });
                }
                return devices;
              };
              const findMenu = () => {
                const roots = [...document.querySelectorAll('[data-testid="device-picker"], [data-testid*="device-picker"], [role="menu"], [role="dialog"]')];
                const parsed = roots.map((root) => ({ root, rows: parseRoot(root).filter((d) => looksLikeDevice(d.name)) }));
                return (parsed.find((p) => p.rows.some((d) => d.local)) || parsed.find((p) => p.rows.length > 0 && p.rows.length <= 8) || {}).root || null;
              };
              const btn = connectButton();
              if (!btn) {
                finish({ remoteName: null, devices: [] });
                return;
              }
              const wasOpen = btn.getAttribute('aria-expanded') === 'true';
              if (!wasOpen) btn.click();
              let menu = null;
              for (let i = 0; i < 25; i++) {
                menu = findMenu();
                if (menu) break;
                await sleep(80);
              }
              let rows = (menu ? parseRoot(menu) : []).filter((d) => looksLikeDevice(d.name));
              if (rows.length > 8 && !rows.some((d) => d.local)) rows = [];
              const closeMenu = async () => {
                if (!btn) return;
                if (btn.getAttribute('aria-expanded') === 'true') btn.click();
                await sleep(40);
              };
              if (action === 'select') {
                const row = rows.find((d) => d.name === target) || rows.find((d) => target && d.name.includes(target));
                if (!row) {
                  await closeMenu();
                  finish({ error: 'Устройство Spotify не найдено' });
                  return;
                }
                row.el.click();
                await sleep(200);
                if (btn && btn.getAttribute('aria-expanded') === 'true') btn.click();
                finish({
                  remoteName: row.local ? null : row.name,
                  selectedLocal: !!row.local,
                  devices: rows.map(({ name, active, local }) => ({ name, active: name === row.name, local })),
                });
                return;
              }
              await closeMenu();
              let remoteName = null;
              const activeRemote = rows.find((d) => d.active && !d.local);
              if (activeRemote) remoteName = activeRemote.name;
              else if (!rows.some((d) => d.active && d.local)) {
                const label = (btn && btn.getAttribute('aria-label')) || '';
                const fromLabel = listeningName(label);
                if (fromLabel && !isLocal(fromLabel)) remoteName = fromLabel;
                else if (label && !isIdle(label) && !isLocal(label)) remoteName = label.trim();
                if (!remoteName) {
                  const bars = [...document.querySelectorAll('[class*="connectBar"], [data-testid*="connect-bar"]')];
                  for (const bar of bars) {
                    const name = listeningName(bar.textContent || '');
                    if (name && !isLocal(name)) { remoteName = name; break; }
                  }
                }
              }
              finish({ remoteName, devices: rows.map(({ name, active, local }) => ({ name, active, local })) });
            } catch (e) {
              finish({ error: String(e && e.message || e) });
            }
          })();
        """
    }
}
