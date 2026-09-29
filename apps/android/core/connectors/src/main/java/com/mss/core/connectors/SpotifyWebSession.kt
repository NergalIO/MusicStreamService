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
    /** Пока true, живые cookie веб-плеера не считаются новым входом. */
    @Volatile private var signedOut = false
    private var loginAgent = false
    private val httpIds = AtomicInteger()
    private val httpWaiters = ConcurrentHashMap<String, CompletableDeferred<Pair<Int, String>>>()
    private val deviceWaiters = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val playWaiters = ConcurrentHashMap<String, CompletableDeferred<Unit>>()
    private val imageWaiters = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val pageMutex = Mutex()
    /** id этого веб-плеера в Spotify Connect (из адресов connect-state), нужен для быстрого старта. */
    private val deviceIds = java.util.Collections.synchronizedSet(linkedSetOf<String>())

    init {
        runCatching {
            CookieManager.getInstance().setAcceptCookie(true)
            restorePersistedCookies()
            CookieManager.getInstance().flush()
        }
        syncLoginState()
    }

    /** Анонимный веб-плеер тоже получает Bearer-токен, поэтому вход подтверждают только cookie sp_dc/sp_key. */
    private fun syncLoginState() {
        if (signedOut) return
        if (hasLoginCookies()) {
            markLoggedIn()
        } else if (_loggedIn.value || hasPersistedSession()) {
            vault.delete(FLAG_KEY)
            _loggedIn.value = false
            _remoteDevice.value = null
        }
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
        if (view.context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
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
        view.setLayerType(WebView.LAYER_TYPE_HARDWARE, null)
        view.isHorizontalScrollBarEnabled = false
        view.addJavascriptInterface(JsBridge(), "MssSpotify")
        view.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = false

            override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): android.webkit.WebResourceResponse? {
                val h = request?.requestHeaders ?: return null
                val auth = h.entries.find { it.key.equals("authorization", true) }?.value
                val client = h.entries.find { it.key.equals("client-token", true) }?.value
                val ver = h.entries.find { it.key.equals("spotify-app-version", true) }?.value
                request.url?.toString()?.let { url ->
                    DEVICE_ID_RE.find(url)?.value?.let { deviceIds.add(it) }
                }
                if (!signedOut && auth?.startsWith("Bearer ") == true && !client.isNullOrBlank()) {
                    headers = SpotifyWebHeaders(auth, client, ver.orEmpty())
                    if (!_loggedIn.value && hasLoginCookies()) markLoggedIn()
                }
                return null
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                if (url?.startsWith(HOME) == true || hasLoginCookies()) syncLoginState()
                if (loginAgent) eval(FIT_MOBILE)
                injectHelpers()
                if (!loginAgent) eval(STATE_OBSERVER)
                if (_loggedIn.value && !loginAgent) eval(SCAN_OPERATIONS)
            }
        }
        restorePersistedCookies()
        syncLoginState()
        view.loadUrl(HOME)
        wake()
    }

    /** Chromium глушит HTML5 audio, если WebView на паузе или INVISIBLE. */
    fun wake() {
        main.post {
            val view = webView ?: return@post
            view.visibility = android.view.View.VISIBLE
            view.onResume()
            view.resumeTimers()
        }
    }

    fun showLogin() {
        signedOut = false
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
        wake()
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

    /**
     * Скачивает картинку через страницу веб-плеера: у Chromium своя сеть, и она доходит до CDN Spotify там,
     * где прямой запрос приложения не проходит. i.scdn.co отдаёт CORS `*`, так что fetch читает тело.
     */
    suspend fun fetchImage(url: String): ByteArray? {
        if (webView == null || _visibleForLogin.value || !url.startsWith("https://")) return null
        val id = httpIds.incrementAndGet().toString()
        val done = CompletableDeferred<String>()
        imageWaiters[id] = done
        eval(
            """
            (async () => {
              try {
                const res = await fetch(${JSONObject.quote(url)}, { credentials: 'omit' });
                if (!res.ok) throw new Error(String(res.status));
                const blob = await res.blob();
                const data = await new Promise((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
                  reader.onerror = () => reject(reader.error);
                  reader.readAsDataURL(blob);
                });
                MssSpotify.onImage('$id', data);
              } catch (e) {
                MssSpotify.onImage('$id', '');
              }
            })();
            """.trimIndent(),
        )
        val base64 = try {
            withTimeoutOrNull(15_000) { done.await() }
        } finally {
            imageWaiters.remove(id)
        } ?: return null
        if (base64.isEmpty()) return null
        return runCatching { android.util.Base64.decode(base64, android.util.Base64.DEFAULT) }.getOrNull()
    }

    fun logout() {
        signedOut = true
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
            val view = webView ?: return@post
            view.stopLoading()
            view.loadUrl("about:blank")
        }
    }

    private fun markLoggedIn() {
        if (signedOut) return
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
        val names = linkedSetOf<String>()
        for (url in SpotifyCookies.URLS) {
            cm.getCookie(url)?.split(';')?.forEach { part ->
                val name = part.substringBefore('=').trim()
                if (name.isNotBlank()) names += name
            }
        }
        val expired = "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; Secure"
        for (url in SpotifyCookies.URLS) {
            for (name in names) {
                cm.setCookie(url, "$name=; $expired")
                cm.setCookie(url, "$name=; $expired; Domain=.spotify.com")
            }
        }
        cm.flush()
    }

    /**
     * @param fast быстрый старт: PUT /v1/me/player/play на этот веб-плеер; при любой ошибке — обычный путь через страницу трека.
     */
    suspend fun play(trackId: String, positionMs: Long = 0, fast: Boolean = false) {
        wake()
        pageMutex.withLock {
            val id = httpIds.incrementAndGet().toString()
            val done = CompletableDeferred<Unit>()
            playWaiters[id] = done
            val auth = headers
            val fastAuth = JSONObject()
                .put("authorization", if (fast) auth?.authorization.orEmpty() else "")
                .put("clientToken", auth?.clientToken.orEmpty())
                .put("appVersion", auth?.appVersion.orEmpty())
                .put("devices", JSONArray(deviceIds.toList()))
                .toString()
            eval(
                """
                (async () => {
                  try {
                    $HELPERS
                    $DEVICE_HELPERS
                    $STATE_OBSERVER
                    const path = '/track/$trackId';
                    const tick = 80;
                    const waitFor = async (ms, ok) => {
                      for (let t = 0; t < ms; t += tick) {
                        if (ok()) return true;
                        await sleep(tick);
                      }
                      return !!ok();
                    };
                    const fastAuth = JSON.parse(${JSONObject.quote(fastAuth)});
                    $FAST_PLAY
                    if (fastAuth.authorization && q('[data-testid="control-button-playpause"]')
                      && await fastPlay(fastAuth, '$trackId', ${positionMs.coerceAtLeast(0)}).catch(() => false)) {
                      MssSpotify.onState(JSON.stringify(readState()));
                      MssSpotify.onRemote(remoteFromBar() || '');
                      MssSpotify.onPlayDone('$id', '');
                      return;
                    }
                    await waitFor(20000, () => q('[data-testid="control-button-playpause"]'));
                    if (!q('[data-testid="control-button-playpause"]')) throw new Error('Веб-плеер Spotify не загрузился');
                    if (location.pathname !== path) {
                      const before = q('main h1')?.textContent || '';
                      history.pushState({}, '', path);
                      dispatchEvent(new PopStateEvent('popstate', { state: {} }));
                      await waitFor(5000, () => (q('main h1')?.textContent || '') !== before);
                      if ((q('main h1')?.textContent || '') === before) {
                        location.assign('https://open.spotify.com' + path);
                        await waitFor(20000, () => q('[data-testid="control-button-playpause"]'));
                      }
                    }
                    let button = null;
                    let heading = '';
                    await waitFor(20000, () => {
                      heading = (q('main h1')?.textContent || '').trim();
                      button = q('main [data-testid="action-bar-row"] [data-testid="play-button"]');
                      return !!(button && heading && location.pathname.indexOf('$trackId') >= 0);
                    });
                    if (!button || location.pathname.indexOf('$trackId') < 0) {
                      heading = (q('main h1')?.textContent || q('[data-testid="context-item-info-title"]')?.textContent || '').trim();
                      button = q('[data-testid="control-button-playpause"]');
                    }
                    if (!button) throw new Error('Не удалось открыть трек в веб-плеере Spotify');
                    const movedHere = await transferHere();
                    if (!movedHere) {
                      throw new Error('Spotify играет на устройстве «' + (remoteFromBar() || 'другом') + '» — выберите это приложение в списке устройств');
                    }
                    if (!isPauseLabel(button)) button.click();
                    await waitFor(10000, () => {
                      const s = readState();
                      return s.playing && (s.title === heading || !heading || s.ad);
                    });
                    const state = readState();
                    if (!state.playing && !state.ad) {
                      throw new Error('Spotify не запустил трек — выберите это приложение в устройствах Spotify');
                    }
                    MssSpotify.onState(JSON.stringify(state));
                    if ($positionMs > 0 && !state.ad && Math.abs(state.positionMs - $positionMs) > 2000) {
                      const progress = q('[data-testid="playback-progressbar"] input[type="range"]');
                      if (progress) setRange(progress, $positionMs);
                    }
                    MssSpotify.onRemote(remoteFromBar() || '');
                    MssSpotify.onPlayDone('$id', '');
                  } catch (e) {
                    try { MssSpotify.onRemote(remoteFromBar() || ''); } catch (_) {}
                    MssSpotify.onPlayDone('$id', String(e && e.message || e));
                  }
                })();
                """.trimIndent(),
            )
            try {
                withTimeoutOrNull(30_000) { done.await() }
                    ?: throw ConnectorException("Spotify не ответил")
            } finally {
                playWaiters.remove(id)
            }
        }
    }

    /** Заранее открывает страницу следующего трека: при переключении останется один клик. Играющий трек не прерывается. */
    fun prefetch(trackId: String) {
        if (!TRACK_ID_RE.matches(trackId) || pageMutex.isLocked || _visibleForLogin.value) return
        eval(
            """
            (function(){
              const path = '/track/$trackId';
              if (location.pathname === path || !document.querySelector('[data-testid="control-button-playpause"]')) return;
              history.pushState({}, '', path);
              dispatchEvent(new PopStateEvent('popstate', { state: {} }));
            })();
            """.trimIndent(),
        )
    }

    /** Открывает меню устройств веб-плеера и возвращает, занят ли аккаунт чужим устройством. */
    suspend fun refreshDevices() {
        if (!pageMutex.tryLock()) return
        try {
            if (_visibleForLogin.value || webView == null) return
            applyDevices(queryDevices("peek", ""))
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

    fun pause() {
        eval(
            """
            (function(){ $HELPERS
              const btn = q('[data-testid="control-button-playpause"]');
              if (btn && isPauseLabel(btn)) btn.click();
            })();
            """.trimIndent(),
        )
    }

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
        main.post {
            view.onResume()
            view.resumeTimers()
            view.evaluateJavascript(script, null)
        }
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
        fun onPlayDone(id: String, error: String) {
            val waiter = playWaiters.remove(id) ?: return
            if (error.isNotBlank()) waiter.completeExceptionally(ConnectorException(error))
            else waiter.complete(Unit)
        }

        @JavascriptInterface
        fun onImage(id: String, base64: String) {
            imageWaiters.remove(id)?.complete(base64)
        }

        @JavascriptInterface
        fun onRemote(name: String) {
            _remoteDevice.value = name.takeIf { it.isNotBlank() }
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

        private val DEVICE_ID_RE = Regex("""https://[^/]+/connect-state/v1/devices/hobs_[0-9a-f]{16,}""")
        private val TRACK_ID_RE = Regex("""[A-Za-z0-9]{10,40}""")

        /**
         * Быстрый старт: команда «play» в Spotify Connect от этого веб-плеера самому себе — тот же канал,
         * которым веб-плеер управляет устройствами. Возвращает false, если что-то не сошлось: тогда работает обычный путь.
         */
        private const val FAST_PLAY = """
          const fastPlay = async (auth, trackId, positionMs) => {
            const devices = [];
            const add = (url) => {
              const m = String(url).match(/(https:\/\/[^\/]+)\/connect-state\/v1\/devices\/(hobs_[0-9a-f]{16,})/);
              if (!m) return;
              const i = devices.findIndex((d) => d.id === m[2]);
              if (i >= 0) devices.splice(i, 1);
              devices.push({ origin: m[1], id: m[2] });
            };
            (auth.devices || []).forEach(add);
            performance.getEntriesByType('resource').forEach((e) => add(e.name));
            const dev = devices[devices.length - 1];
            if (!dev) return false;
            const read = () => readState();
            const before = read();
            const uri = 'spotify:track:' + trackId;
            const res = await fetch(dev.origin + '/connect-state/v1/player/command/from/' + dev.id + '/to/' + dev.id, {
              method: 'POST',
              headers: {
                authorization: auth.authorization,
                'client-token': auth.clientToken,
                'spotify-app-version': auth.appVersion,
                'app-platform': 'WebPlayer',
                'content-type': 'application/json',
              },
              body: JSON.stringify({
                command: {
                  context: { uri, url: 'context://' + uri, metadata: {} },
                  play_origin: { feature_identifier: 'harmony', feature_version: auth.appVersion || '' },
                  options: { skip_to: { track_uri: uri }, seek_to: positionMs, player_options_override: {} },
                  logging_params: { command_id: Math.random().toString(16).slice(2) + Date.now().toString(16) },
                  endpoint: 'play',
                },
              }),
            });
            if (!res.ok) return false;
            for (let t = 0; t < 5000; t += 80) {
              const s = read();
              const restarted = s.positionMs < positionMs + 3000 && (!before.playing || before.positionMs > positionMs + 3000);
              if (s.ad || (s.playing && (s.title !== before.title || restarted))) return true;
              await new Promise((r) => setTimeout(r, 80));
            }
            return false;
          };
        """

        /**
         * Шлёт состояние плеера в приложение сразу при изменении нижней панели, без ожидания опроса.
         * Ставится один раз на страницу; панель пересоздаётся при навигации, поэтому раз в секунду переподключаемся.
         */
        private const val STATE_OBSERVER = """
          (function(){
            if (window.__mssObserver) return;
            const pick = () => document.querySelector('[data-testid="now-playing-bar"]') || document.querySelector('footer');
            const isPause = (el) => /pause|пауз/i.test(el?.getAttribute('aria-label') || '');
            const clock = (t) => (t || '').trim().split(':').reduce((a, p) => a * 60 + (Number(p) || 0), 0) * 1000;
            const read = () => {
              const g = (s) => document.querySelector(s);
              const button = g('[data-testid="control-button-playpause"]');
              const progress = g('[data-testid="playback-progressbar"] input[type="range"]');
              const title = (g('[data-testid="context-item-info-title"]')?.textContent || '').trim();
              return {
                ready: !!button,
                title,
                playing: isPause(button),
                ad: !!g('[data-testid="ad-skip-button"], [data-testid="ad-cta-button"]') || /advertisement|реклама/i.test(title),
                positionMs: clock(g('[data-testid="playback-position"]')?.textContent),
                durationMs: Number(progress?.max) || clock(g('[data-testid="playback-duration"]')?.textContent),
              };
            };
            let last = '';
            let queued = false;
            const push = () => {
              queued = false;
              const s = read();
              const key = JSON.stringify(s);
              if (key === last) return;
              last = key;
              try { MssSpotify.onState(key); } catch (_) {}
            };
            const schedule = () => {
              if (queued) return;
              queued = true;
              setTimeout(push, 16);
            };
            let bar = null;
            const obs = new MutationObserver(schedule);
            const attach = () => {
              const next = pick();
              if (!next || next === bar) return;
              obs.disconnect();
              bar = next;
              obs.observe(bar, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'value', 'max'] });
              schedule();
            };
            window.__mssObserver = obs;
            attach();
            setInterval(attach, 1000);
          })();
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

        /** Общий код панели устройств: «This web browser» — это мы, «Playing on …» в нижней панели — чужое устройство. */
        private const val DEVICE_HELPERS = """
          const dSleep = (ms) => new Promise((r) => setTimeout(r, ms));
          const LOCAL_RE = /this web browser|этот веб-браузер|этот браузер|this computer|этот компьютер|this device|это устройство/i;
          const PLAYING_RE = /^(?:playing on|listening on|воспроизводится на|воспроизведение на|слушаете на|играет на)\s+/i;
          const CONNECT_ROW_RE = /^(?:connect to this device|подключиться к этому устройству|подключить это устройство)[.…]?/i;
          const isLocalName = (n) => LOCAL_RE.test(String(n || ''));
          const remoteFromBar = () => {
            const bar = document.querySelector('[data-testid="now-playing-bar"]') || document.querySelector('footer');
            if (!bar) return null;
            for (const el of bar.querySelectorAll('button, a, span, div')) {
              if (el.childElementCount > 4) continue;
              const t = String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
              if (!PLAYING_RE.test(t)) continue;
              const name = t.replace(PLAYING_RE, '').trim();
              if (name && !isLocalName(name)) return name;
            }
            return null;
          };
          const connectBtn = () =>
            document.querySelector('[data-testid="connect-device-picker"], [data-testid="device-picker-icon-button"], [data-testid="control-button-connect"]')
            || [...document.querySelectorAll('[data-testid="now-playing-bar"] button, footer button')]
              .find((b) => /connect|device|устройств/i.test(b.getAttribute('aria-label') || '')) || null;
          const pickerRows = () => [...document.querySelectorAll('[data-testid="device-picker-row-sidepanel"], [data-testid="device-picker-item"]')];
          const openPicker = async () => {
            if (pickerRows().length) return true;
            const b = connectBtn();
            if (!b) return false;
            b.click();
            for (let i = 0; i < 30 && !pickerRows().length; i++) await dSleep(100);
            return pickerRows().length > 0;
          };
          const closePicker = async () => {
            if (!pickerRows().length) return;
            const close = document.querySelector('[data-testid="PanelHeader_CloseButton"] button, [data-testid="PanelHeader_CloseButton"]');
            if (close) close.click(); else connectBtn()?.click();
            for (let i = 0; i < 20 && pickerRows().length; i++) await dSleep(100);
          };
          const readPicker = () => {
            const out = [];
            const seen = new Set();
            for (const row of pickerRows()) {
              const titled = row.querySelector('[data-testid="list-row-title"]')?.textContent;
              const lines = String(titled || row.innerText || '').split('\n').map((s) => s.trim()).filter((s) => s && !CONNECT_ROW_RE.test(s));
              const name = lines[lines.length - 1] || '';
              if (!name || name.length > 60) continue;
              const inList = !!row.closest('ul, [role="list"]');
              const key = name + (inList ? '|list' : '|current');
              if (seen.has(key)) continue;
              seen.add(key);
              out.push({ name, active: !inList, local: isLocalName(name), el: row.querySelector('[role="button"]') || row });
            }
            return out;
          };
          const transferHere = async () => {
            if (!remoteFromBar()) return true;
            if (!(await openPicker())) return false;
            const here = readPicker().find((d) => d.local && !d.active);
            if (here) {
              here.el.click();
              for (let i = 0; i < 24 && remoteFromBar(); i++) await dSleep(250);
            }
            await closePicker();
            return !remoteFromBar();
          };
        """

        private const val DEVICE_SCRIPT = """
          (async () => {
            const action = '%%ACTION%%';
            const target = %%TARGET%%;
            const doneId = '%%ID%%';
            const finish = (payload) => MssSpotify.onDeviceResult(doneId, JSON.stringify(payload));
            try {
              $DEVICE_HELPERS
              const plain = (list) => list.map(({ name, active, local }) => ({ name, active, local }));
              if (action === 'select') {
                if (!(await openPicker())) {
                  finish({ error: 'Кнопка устройств Spotify не найдена' });
                  return;
                }
                const rows = readPicker();
                const row = rows.find((d) => !d.active && d.name === target)
                  || rows.find((d) => !d.active && target && d.name.includes(target))
                  || rows.find((d) => d.name === target);
                if (!row) {
                  await closePicker();
                  finish({ error: 'Устройство Spotify не найдено' });
                  return;
                }
                if (!row.active) row.el.click();
                for (let i = 0; i < 16; i++) {
                  await dSleep(250);
                  const r = remoteFromBar();
                  if (row.local ? !r : r) break;
                }
                await closePicker();
                const remoteName = remoteFromBar();
                finish({
                  remoteName,
                  selectedLocal: row.local && !remoteName,
                  devices: plain(rows),
                });
                return;
              }
              let remoteName = remoteFromBar();
              let rows = [];
              if (action === 'list') {
                const wasOpen = pickerRows().length > 0;
                if (await openPicker()) {
                  rows = readPicker();
                  if (!wasOpen) await closePicker();
                }
                if (!remoteName) {
                  const current = rows.find((d) => d.active && !d.local);
                  if (current && rows.some((d) => d.local && !d.active)) remoteName = current.name;
                }
              }
              finish({ remoteName, devices: plain(rows) });
            } catch (e) {
              finish({ error: String(e && e.message || e) });
            }
          })();
        """
    }
}
