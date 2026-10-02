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
    val trackId: String = "",
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
    private val playWaiters = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private val imageWaiters = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val pageMutex = Mutex()
    /** id этого веб-плеера в Spotify Connect (из адресов connect-state), нужен для быстрого старта. */
    private val deviceIds = java.util.Collections.synchronizedSet(linkedSetOf<String>())
    @Volatile private var ownDeviceUrl: String? = null
    @Volatile var onTrackEnded: ((String) -> Unit)? = null
    @Volatile private var bridgeScript: String? = null

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

    /** Сохранённые cookie Spotify больше не принимает: показываем «войти снова», а не «подключено». */
    var sessionRejected: Boolean = false
        private set

    fun markSessionExpired() {
        sessionRejected = true
        _loggedIn.value = false
    }

    fun operationHash(name: String): String? = hashes[name]

    fun invalidateHashes() {
        hashes = emptyMap()
        injectBridge()
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
                injectBridge()
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
        // Мёртвые cookie иначе молча вернут тот же аккаунт вместо формы входа.
        val stale = sessionRejected
        if (stale) {
            vault.delete(COOKIE_KEY)
            vault.delete(FLAG_KEY)
        }
        signedOut = false
        sessionRejected = false
        _visibleForLogin.value = true
        loginAgent = true
        main.post {
            if (stale) clearSpotifyCookies()
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
        sessionRejected = false
        _visibleForLogin.value = false
        _loggedIn.value = false
        _remoteDevice.value = null
        loginAgent = false
        headers = null
        hashes = emptyMap()
        ownDeviceUrl = null
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
        sessionRejected = false
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
        WebCookies.clear(WebCookies.SPOTIFY_URLS, WebCookies.SPOTIFY_DOMAINS, SESSION_COOKIES)
    }

    /**
     * @param fast быстрый старт: команда play в connect-state этого веб-плеера; при ошибке — страница трека.
     */
    suspend fun play(trackId: String, positionMs: Long = 0, fast: Boolean = false) {
        if (!TRACK_ID_RE.matches(trackId)) throw ConnectorException("Некорректный id трека Spotify")
        wake()
        if (webView == null) throw ConnectorException("Веб-плеер Spotify не запущен — откройте Spotify в приложении")
        cancelActivePlay()
        ensureBridge()
        val first = awaitPlay(trackId, positionMs, fast)
        if (first.optBoolean("cancelled")) return
        if (first.optBoolean("authFailed") && fast) {
            invalidateHeaders()
            runCatching { awaitHeaders() }
            awaitPlay(trackId, positionMs, true)
        }
    }

    fun cancelActivePlay() {
        val cancelled = JSONObject().put("cancelled", true)
        playWaiters.values.forEach { it.complete(cancelled) }
        playWaiters.clear()
        eval("window.__mss && window.__mss.cancel()")
    }

    fun stopPlayback() {
        cancelActivePlay()
        eval("window.__mss && window.__mss.stop()")
    }

    private fun deviceListForFastPlay(): List<String> {
        val own = ownDeviceUrl
        if (own.isNullOrBlank()) return deviceIds.toList()
        return listOf(own) + deviceIds.filter { it != own }
    }

    private suspend fun awaitPlay(trackId: String, positionMs: Long, fast: Boolean): JSONObject {
        val id = httpIds.incrementAndGet().toString()
        val done = CompletableDeferred<JSONObject>()
        playWaiters[id] = done
        val auth = headers
        val fastAuth = JSONObject()
            .put("authorization", if (fast) auth?.authorization.orEmpty() else "")
            .put("clientToken", auth?.clientToken.orEmpty())
            .put("appVersion", auth?.appVersion.orEmpty())
            .put("devices", JSONArray(deviceListForFastPlay()))
            .toString()
        eval(
            """
            (async () => {
              const id = ${JSONObject.quote(id)};
              try {
                if (!window.__mss) throw new Error('Веб-плеер Spotify не загрузился');
                const auth = JSON.parse(${JSONObject.quote(fastAuth)});
                const r = await window.__mss.play(${JSONObject.quote(trackId)}, ${positionMs.coerceAtLeast(0)}, auth);
                MssSpotify.onPlayDone(id, JSON.stringify(r || { cancelled: true }));
              } catch (e) {
                MssSpotify.onPlayDone(id, JSON.stringify({ error: String(e && e.message || e) }));
              }
            })();
            """.trimIndent(),
        )
        val result = try {
            withTimeoutOrNull(20_000) { done.await() }
                ?: throw ConnectorException("Spotify не ответил")
        } finally {
            playWaiters.remove(id)
        }
        if (result.optBoolean("cancelled")) return result
        result.optString("deviceUrl").takeIf { it.isNotBlank() }?.let { ownDeviceUrl = it }
        runCatching {
            val title = result.optString("trackTitle").ifBlank { result.optString("title") }
            _dom.value = SpotifyDomState(
                ready = result.optBoolean("ready"),
                playing = result.optBoolean("playing"),
                ad = result.optBoolean("ad"),
                positionMs = result.optLong("positionMs"),
                durationMs = result.optLong("durationMs"),
                title = title,
                trackId = result.optString("trackId"),
            )
        }
        result.opt("remoteName")
            ?.takeUnless { it == JSONObject.NULL }
            ?.toString()
            ?.let { _remoteDevice.value = it.takeIf { name -> name.isNotBlank() && name != "null" } }
        val error = result.optString("error")
        if (error.isNotBlank() && !result.optBoolean("authFailed") && result.opt("remoteName") == JSONObject.NULL) {
            throw ConnectorException(error)
        }
        if (error.isNotBlank() && !result.optBoolean("authFailed") && result.optString("remoteName").isBlank()) {
            throw ConnectorException(error)
        }
        return result
    }

    /** Баннер «играет на …» без открытия пикера: не ждёт pageMutex и очередь play. */
    suspend fun refreshDevices() {
        if (_visibleForLogin.value || webView == null) return
        applyDevices(queryDevices("peek", ""))
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
        ensureBridge()
        val id = httpIds.incrementAndGet().toString()
        val done = CompletableDeferred<String>()
        deviceWaiters[id] = done
        eval(
            """
            (async () => {
              const id = ${JSONObject.quote(id)};
              try {
                if (!window.__mss) throw new Error('Веб-плеер Spotify не загрузился');
                const r = await window.__mss.devices(${JSONObject.quote(action)}, ${JSONObject.quote(target)});
                MssSpotify.onDeviceResult(id, JSON.stringify(r || {}));
              } catch (e) {
                MssSpotify.onDeviceResult(id, JSON.stringify({ error: String(e && e.message || e) }));
              }
            })();
            """.trimIndent(),
        )
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
        cancelActivePlay()
        eval("window.__mss && window.__mss.pause()")
    }

    fun resume() = playCurrent()

    fun seek(positionMs: Long) {
        eval("window.__mss && window.__mss.seek($positionMs)")
    }

    fun setVolume(volume: Float) {
        val fraction = volume.coerceIn(0f, 1f)
        eval("window.__mss && window.__mss.setVolume($fraction)")
    }

    fun pollState() {
        if (pageMutex.isLocked) return
        eval("window.__mss && MssSpotify.onState(JSON.stringify(window.__mss.state()))")
    }

    private fun playCurrent() {
        eval("window.__mss && window.__mss.resume()")
    }

    private fun injectBridge() {
        val js = bridgeScript ?: loadBridgeScript() ?: return
        val view = webView ?: return
        main.post {
            view.onResume()
            view.resumeTimers()
            view.evaluateJavascript("!!(window.__mss && window.__mss.version === $BRIDGE_VERSION)") { ready ->
                if (ready != "true") view.evaluateJavascript(js, null)
            }
        }
    }

    private suspend fun ensureBridge() {
        val js = bridgeScript ?: loadBridgeScript() ?: return
        val view = webView ?: return
        val done = CompletableDeferred<Unit>()
        main.post {
            view.onResume()
            view.resumeTimers()
            view.evaluateJavascript("!!(window.__mss && window.__mss.version === $BRIDGE_VERSION)") { ready ->
                if (ready == "true") {
                    if (!done.isCompleted) done.complete(Unit)
                } else {
                    view.evaluateJavascript(js) {
                        if (!done.isCompleted) done.complete(Unit)
                    }
                }
            }
        }
        withTimeoutOrNull(4_000) { done.await() }
    }

    private fun loadBridgeScript(): String? {
        val view = webView ?: return null
        return runCatching {
            view.context.assets.open(BRIDGE_ASSET).bufferedReader().use { it.readText() }
        }.getOrNull()?.also { bridgeScript = it }
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
        fun onPlayDone(id: String, resultJson: String) {
            val waiter = playWaiters.remove(id) ?: return
            val obj = runCatching { JSONObject(resultJson) }.getOrNull()
            if (obj != null) waiter.complete(obj)
            else waiter.completeExceptionally(ConnectorException(resultJson.ifBlank { "Spotify не ответил" }))
        }

        @JavascriptInterface
        fun onEnded(trackId: String) {
            if (trackId.isNotBlank()) onTrackEnded?.invoke(trackId)
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
                    trackId = obj.optString("trackId"),
                )
            }
        }
    }

    companion object {
        private const val BRIDGE_ASSET = "spotify-page-bridge.inject.js"
        private const val BRIDGE_VERSION = 9
        private const val HOME = "https://open.spotify.com/"
        private const val COOKIE_KEY = "spotify_web_cookies"
        private const val FLAG_KEY = "spotify_web_logged_in"
        /** Гасим и те cookie входа, которых может не оказаться в заголовке текущего домена. */
        private val SESSION_COOKIES = listOf("sp_dc", "sp_key", "sp_t", "sp_landing", "sp_m", "sp_adid")
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

        private val DEVICE_ID_RE = Regex("""https://[^/]+/connect-state/v1/devices/hobs_[0-9a-f]{16,}""")
        private val TRACK_ID_RE = Regex("""[A-Za-z0-9]{10,40}""")

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
    }
}
