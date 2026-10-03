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
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
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
    val id: String = "",
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
    @Volatile private var connectionId: String? = null
    @Volatile private var spclientHosts: List<String>? = null
    private val observerDeviceId = java.util.UUID.randomUUID().toString().replace("-", "").take(16)

    private val _visibleForLogin = MutableStateFlow(false)
    val visibleForLogin: StateFlow<Boolean> = _visibleForLogin

    private val hashes = java.util.concurrent.ConcurrentHashMap<String, String>()
    /** Пока true, живые cookie веб-плеера не считаются новым входом. */
    @Volatile private var signedOut = false
    private var loginAgent = false
    private val httpIds = AtomicInteger()
    private val httpWaiters = ConcurrentHashMap<String, CompletableDeferred<Pair<Int, String>>>()
    private val deviceWaiters = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val playWaiters = ConcurrentHashMap<String, CompletableDeferred<JSONObject>>()
    private val imageWaiters = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val hashSniffWaiters = ConcurrentHashMap<String, CompletableDeferred<String>>()
    private val pageMutex = Mutex()
    @Volatile var onTrackEnded: ((String) -> Unit)? = null
    @Volatile private var bridgeScript: String? = null
    @Volatile private var hashesSniffed = false

    init {
        DEFAULT_QUERY_HASHES.forEach { (name, hash) -> hashes[name] = hash }
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

    fun rememberOperationHash(name: String, hash: String) {
        if (name.isBlank() || !HASH_RE.matches(hash)) return
        hashes[name] = hash
    }

    /**
     * Pull persisted-query hashes from the open.spotify.com JS bundles (same idea as
     * desktop SpotifyInjectorSession.sniffHashes). Network hook alone only sees ops
     * the user already triggered in the WebView.
     */
    suspend fun sniffOperationHashes(force: Boolean = false) {
        if (hashesSniffed && !force) return
        if (webView == null) return
        ensureBridge()
        val id = httpIds.incrementAndGet().toString()
        val done = CompletableDeferred<String>()
        hashSniffWaiters[id] = done
        eval(
            """
            (async () => {
              const id = ${JSONObject.quote(id)};
              const found = [];
              const seen = new Set();
              const push = (name, hash) => {
                if (!name || !/^[a-f0-9]{64}$/i.test(hash || '')) return;
                const key = name + ':' + hash;
                if (seen.has(key)) return;
                seen.add(key);
                found.push({ operationName: name, sha256Hash: hash });
              };
              const extract = (source) => {
                if (!source || typeof source !== 'string') return;
                const forward = /operationName["'\s:=]+["']([A-Za-z][A-Za-z0-9_]*)["'][\s\S]{0,500}?sha256Hash["'\s:=]+["']([a-f0-9]{64})["']/gi;
                const reverse = /sha256Hash["'\s:=]+["']([a-f0-9]{64})["'][\s\S]{0,500}?operationName["'\s:=]+["']([A-Za-z][A-Za-z0-9_]*)["']/gi;
                const named = /["'](addToLibrary|removeFromLibrary|isInLibrary|areEntitiesInLibrary|addItemsToLibrary|removeItemsFromLibrary|searchDesktop|searchV2|searchTracks|libraryV3|fetchLibraryTracks|fetchPlaylist|getAlbum|getTrack|queryArtistOverview|searchArtists)["']\s*:\s*["']([a-f0-9]{64})["']/g;
                const nameValue = /name:\s*["']([A-Za-z][A-Za-z0-9_]+)["'][\s\S]{0,300}?sha256Hash["'\s:=]+["']([a-f0-9]{64})["']/gi;
                const compact = /"([A-Za-z][A-Za-z0-9_]*)","(?:query|mutation)","([a-f0-9]{64})"/g;
                let m;
                while ((m = forward.exec(source))) push(m[1], m[2]);
                while ((m = reverse.exec(source))) push(m[2], m[1]);
                while ((m = named.exec(source))) push(m[1], m[2]);
                while ((m = nameValue.exec(source))) push(m[1], m[2]);
                while ((m = compact.exec(source))) push(m[1], m[2]);
              };
              try {
                for (const script of document.scripts) {
                  if (!script.src && script.textContent) extract(script.textContent);
                }
                const urls = [
                  ...Array.from(document.scripts).map((s) => s.src),
                  ...Array.from(document.querySelectorAll("link[rel='modulepreload'], link[rel='preload'][as='script']")).map((l) => l.href),
                  ...performance.getEntriesByType('resource').map((e) => e.name),
                ].filter((src) => /spotifycdn|web-player|xpui/i.test(src) && /\.js(\?|$)/i.test(src));
                const ranked = [...new Set(urls)].sort((a, b) => {
                  const score = (url) => {
                    if (/web-player\.[a-f0-9]/i.test(url)) return 4;
                    if (/web-player/i.test(url)) return 3;
                    if (/xpui/i.test(url)) return 2;
                    return 1;
                  };
                  return score(b) - score(a);
                }).slice(0, 10);
                for (const url of ranked) {
                  try {
                    const res = await fetch(url, { credentials: 'omit', signal: AbortSignal.timeout(8000) });
                    if (!res.ok) continue;
                    const text = await res.text();
                    extract(text);
                    if (found.some((item) => item.operationName === 'libraryV3' || item.operationName === 'fetchLibraryTracks' || item.operationName === 'fetchPlaylist')) break;
                  } catch (e) {}
                }
              } catch (e) {}
              MssSpotify.onHashes(id, JSON.stringify(found));
            })();
            """.trimIndent(),
        )
        try {
            val raw = withTimeoutOrNull(20_000) { done.await() } ?: "[]"
            val arr = org.json.JSONArray(raw)
            for (i in 0 until arr.length()) {
                val row = arr.optJSONObject(i) ?: continue
                rememberOperationHash(row.optString("operationName"), row.optString("sha256Hash"))
            }
            hashesSniffed = true
        } catch (_: Throwable) {
            hashesSniffed = false
        } finally {
            hashSniffWaiters.remove(id)
        }
    }

    /**
     * Soft-navigate so the WebView fires real pathfinder calls and the fetch hook can capture hashes
     * that bundle sniffing missed (library pages).
     */
    suspend fun nudgeLibraryPathfinder() {
        if (webView == null) return
        ensureBridge()
        eval(
            """
            (async () => {
              try {
                if (!location.href.includes('open.spotify.com')) return;
                const paths = ['/collection/tracks', '/collection/playlists'];
                for (const path of paths) {
                  history.pushState({}, '', path);
                  window.dispatchEvent(new PopStateEvent('popstate'));
                  await new Promise((r) => setTimeout(r, 900));
                }
              } catch (e) {}
            })();
            """.trimIndent(),
        )
        delay(2200)
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
                val conn = h.entries.find { it.key.equals("x-spotify-connection-id", true) }?.value
                request.url?.toString()?.let { url -> rememberPathfinderUrl(url) }
                if (!conn.isNullOrBlank()) connectionId = conn
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
            }
        }
    }

    suspend fun awaitHeaders(timeoutMs: Long = 20_000): SpotifyWebHeaders {
        headers?.let { return it }
        ensurePlayer()
        val deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs
        var found: SpotifyWebHeaders? = headers
        while (android.os.SystemClock.elapsedRealtime() < deadline) {
            found = headers
            if (found != null) return found
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

    suspend fun resolveSpclient(): List<String> {
        spclientHosts?.let { return it }
        val (_, text) = browserFetch("GET", APRESOLVE_URL, null)
        val hosts = parseSpclientHosts(text)
        val resolved = if (hosts.isNotEmpty()) hosts else FALLBACK_SPCLIENT
        spclientHosts = resolved
        return resolved
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

    suspend fun play(trackId: String, positionMs: Long = 0) {
        if (!TRACK_ID_RE.matches(trackId)) throw ConnectorException("Некорректный id трека Spotify")
        wake()
        if (webView == null) throw ConnectorException("Веб-плеер Spotify не запущен — откройте Spotify в приложении")
        cancelActivePlay()
        ensureBridge()
        val first = awaitPlay(trackId, positionMs)
        if (first.optBoolean("cancelled")) return
    }

    fun cancelActivePlay() {
        val cancelled = JSONObject().put("cancelled", true)
        playWaiters.values.forEach { it.complete(cancelled) }
        playWaiters.clear()
    }

    fun stopPlayback() {
        cancelActivePlay()
        eval("window.__spotifyBridge && window.__spotifyBridge.pause()")
    }

    private suspend fun awaitPlay(trackId: String, positionMs: Long): JSONObject {
        val id = httpIds.incrementAndGet().toString()
        val done = CompletableDeferred<JSONObject>()
        playWaiters[id] = done
        // bridge.play first; never full-navigate (location.href kills the callback and yields «не ответил»).
        eval(
            """
            (async () => {
              const waiterId = ${JSONObject.quote(id)};
              const trackId = ${JSONObject.quote(trackId)};
              const positionMs = ${positionMs.coerceAtLeast(0)};
              const uri = 'spotify:track:' + trackId;
              let finished = false;
              const finish = (payload) => {
                if (finished) return;
                finished = true;
                try { MssSpotify.onPlayDone(waiterId, JSON.stringify(payload)); } catch (e) {}
              };
              const toastUnavailable = () => {
                const nodes = document.querySelectorAll('[role="alert"], [role="status"], [data-testid*="toast"]');
                for (const el of nodes) {
                  if (/этот трек недоступен|this track is unavailable|isn't available/i.test(el.textContent || '')) return true;
                }
                return false;
              };
              const snapshot = () => {
                try { return window.__spotifyBridge && window.__spotifyBridge.getState && window.__spotifyBridge.getState(); }
                catch (e) { return null; }
              };
              const matches = (s) => !!(s && (s.id === trackId || s.uri === uri));
              const foreignPlaying = (s) => !!(s && s.isPlaying && s.id && s.id !== trackId && s.uri && String(s.uri).indexOf(':ad:') < 0);
              const confirmPlaying = async () => {
                for (let i = 0; i < 20; i += 1) {
                  if (toastUnavailable()) return false;
                  const state = snapshot();
                  if (matches(state) && state.isPlaying) return true;
                  // Audible start often precedes metadata — accept playing without foreign id.
                  if (state && state.isPlaying && !foreignPlaying(state) && (!state.id || matches(state))) {
                    if (i >= 4) return true;
                  }
                  await new Promise((r) => setTimeout(r, 200));
                }
                const last = snapshot();
                return !!(last && last.isPlaying && !foreignPlaying(last));
              };
              const doneOk = (s) => {
                const cur = s || snapshot() || {};
                finish({
                  ready: !!cur.ready,
                  playing: cur.isPlaying !== false,
                  positionMs: cur.positionMs || positionMs,
                  durationMs: cur.durationMs || 0,
                  title: cur.title || '',
                  trackId: cur.id || trackId,
                  cancelled: false,
                });
              };
              try {
                const bridge = window.__spotifyBridge;
                if (!bridge) throw new Error('bridge_missing');
                try {
                  const play = await bridge.play({ uri: uri, positionMs: positionMs });
                  if (play && play.ok) {
                    if (await confirmPlaying()) { doneOk(bridge.getState()); return; }
                    // play.ok but metadata lag — still succeed if not clearly foreign/unavailable
                    if (!toastUnavailable() && !foreignPlaying(snapshot())) { doneOk(bridge.getState()); return; }
                  }
                  if ((play && play.error === 'track_unavailable') || toastUnavailable()) {
                    throw new Error('track_unavailable');
                  }
                } catch (bridgeErr) {
                  if (String(bridgeErr && bridgeErr.message || bridgeErr) === 'track_unavailable') throw bridgeErr;
                }
                if (await confirmPlaying()) { doneOk(snapshot()); return; }
                const capture = window.__spotifyAuthCapture;
                const token = capture && capture.accessToken;
                if (token) {
                  try {
                    const res = await fetch('https://api.spotify.com/v1/me/player/play', {
                      method: 'PUT',
                      headers: Object.assign({
                        Authorization: 'Bearer ' + token,
                        'Content-Type': 'application/json',
                      }, capture.clientToken ? { 'client-token': capture.clientToken } : {}),
                      body: JSON.stringify({ uris: [uri], position_ms: positionMs }),
                    });
                    if ((res.ok || res.status === 204) && await confirmPlaying()) {
                      doneOk(snapshot());
                      return;
                    }
                  } catch (_publicErr) {}
                }
                // DOM click only — do NOT assign location.href (reloads WebView and drops this callback).
                const headerPlay = () => {
                  const main = document.querySelector('main') || document.body;
                  const buttons = main.querySelectorAll('[data-testid="play-button"], [data-testid="entity-action-play"]');
                  for (const el of buttons) {
                    if (!(el instanceof HTMLElement)) continue;
                    const label = (el.getAttribute('aria-label') || '').toLowerCase();
                    if (/pause|пауза/.test(label)) continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.width >= 24 && rect.height >= 24) return el;
                  }
                  return null;
                };
                const btn = headerPlay();
                if (btn) {
                  btn.click();
                  if (await confirmPlaying()) { doneOk(snapshot()); return; }
                }
                if (await confirmPlaying()) { doneOk(snapshot()); return; }
                throw new Error(toastUnavailable() ? 'track_unavailable' : 'player_method_missing');
              } catch (e) {
                finish({ error: String(e && e.message || e) });
              }
            })();
            """.trimIndent(),
        )
        // Resolve early from Kotlin-side DOM polls while JS is still confirming.
        val result = try {
            coroutineScope {
                val pollJob = launch {
                    repeat(40) {
                        delay(500)
                        if (done.isCompleted) return@launch
                        val d = _dom.value
                        if (d.playing && (d.trackId == trackId || (d.trackId.isBlank() && d.ready))) {
                            done.complete(
                                JSONObject()
                                    .put("ready", d.ready)
                                    .put("playing", true)
                                    .put("positionMs", d.positionMs)
                                    .put("durationMs", d.durationMs)
                                    .put("title", d.title)
                                    .put("trackId", d.trackId.ifBlank { trackId })
                                    .put("cancelled", false),
                            )
                            return@launch
                        }
                    }
                }
                try {
                    withTimeoutOrNull(25_000) { done.await() }
                        ?: throw ConnectorException("Spotify не ответил")
                } finally {
                    pollJob.cancel()
                }
            }
        } finally {
            playWaiters.remove(id)
        }
        if (result.optBoolean("cancelled")) return result
        runCatching {
            val title = jsonText(result, "trackTitle").ifBlank { jsonText(result, "title") }
            _dom.value = SpotifyDomState(
                ready = result.optBoolean("ready"),
                playing = result.optBoolean("playing"),
                ad = result.optBoolean("ad"),
                positionMs = result.optLong("positionMs"),
                durationMs = result.optLong("durationMs"),
                title = title,
                trackId = jsonText(result, "trackId"),
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
        val listed = fetchConnectDevices()
        val devices = listed.map { d ->
            SpotifyDevice(d.name, d.active, LOCAL_DEVICE_RE.containsMatchIn(d.name), d.id)
        }
        var remoteName = devices.firstOrNull { it.active && !it.local }?.name
        var selectedLocal = false
        if (action == "select" && target.isNotBlank()) {
            val pick = devices.firstOrNull { it.name == target }
                ?: throw ConnectorException("Устройство Spotify не найдено")
            if (pick.local) {
                selectedLocal = true
                remoteName = null
            } else {
                transferPlayback(pick.id)
                remoteName = pick.name
            }
        }
        return DeviceQuery(remoteName, devices, selectedLocal)
    }

    private data class RawDevice(val id: String, val name: String, val active: Boolean)

    private suspend fun fetchConnectDevices(): List<RawDevice> {
        val hosts = resolveSpclient()
        val observer = if (observerDeviceId.startsWith("hobs_")) observerDeviceId else "hobs_$observerDeviceId"
        val clusterBody = """{"member_type":"CONNECT_STATE","device":{"device_info":{"capabilities":{"can_be_player":false,"hidden":true,"needs_full_player_state":true,"is_observable":true}}}}"""
        for (host in hosts) {
            val base = host.trimEnd('/')
            val cluster = browserFetch("PUT", "$base/connect-state/v1/devices/$observer", clusterBody)
            parseConnectDevices(cluster.second).takeIf { it.isNotEmpty() }?.let { return it }
            val listed = browserFetch("GET", "$base/connect-state/v1/devices", null)
            parseConnectDevices(listed.second).takeIf { it.isNotEmpty() }?.let { return it }
        }
        val rest = browserFetch("GET", "https://api.spotify.com/v1/me/player/devices", null)
        return parseConnectDevices(rest.second)
    }

    private suspend fun transferPlayback(deviceId: String) {
        val fromId = connectionId
        val hosts = resolveSpclient()
        if (!fromId.isNullOrBlank()) {
            val body = """{"command":{"endpoint":"transfer","options":{"restore_paused":"error"}}}"""
            for (host in hosts) {
                val base = host.trimEnd('/')
                val encodedFrom = java.net.URLEncoder.encode(fromId, Charsets.UTF_8)
                val encodedTo = java.net.URLEncoder.encode(deviceId, Charsets.UTF_8)
                val command = browserFetch(
                    "POST",
                    "$base/connect-state/v1/player/command/from/$encodedFrom/to/$encodedTo",
                    body,
                )
                if (command.first in 200..299) return
                val transfer = browserFetch(
                    "POST",
                    "$base/connect-state/v1/connect/transfer/from/$encodedFrom/to/$encodedTo",
                    """{"play":true}""",
                )
                if (transfer.first in 200..299) return
            }
        }
        val rest = browserFetch(
            "PUT",
            "https://api.spotify.com/v1/me/player",
            """{"device_ids":[${JSONObject.quote(deviceId)}],"play":true}""",
        )
        if (rest.first !in 200..299 && rest.first != 204) throw ConnectorException("Не удалось переключить устройство")
    }

    private fun parseConnectDevices(raw: String): List<RawDevice> {
        val root = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyList()
        val cluster = root.optJSONObject("cluster")
        if (cluster != null && cluster !== root) {
            val nested = parseConnectDevices(cluster.toString())
            if (nested.isNotEmpty()) return nested
        }
        val out = mutableListOf<RawDevice>()
        val seen = mutableSetOf<String>()
        fun add(id: String, name: String, active: Boolean) {
            if (id.isBlank() || !seen.add(id) || id == observerDeviceId || id == "hobs_$observerDeviceId") return
            out.add(RawDevice(id, name.ifBlank { id }, active))
        }
        val arr = root.optJSONArray("devices")
        if (arr != null) {
            for (i in 0 until arr.length()) {
                val rec = arr.optJSONObject(i) ?: continue
                val info = rec.optJSONObject("device_info") ?: rec.optJSONObject("deviceInfo") ?: rec
                add(
                    info.optString("id").ifBlank { rec.optString("id") },
                    info.optString("name").ifBlank { info.optString("device_name") },
                    info.optBoolean("is_active") || info.optBoolean("isActive") || rec.optBoolean("is_active"),
                )
            }
            return out
        }
        val map = root.optJSONObject("devices") ?: root.optJSONObject("device")
        if (map != null) {
            val keys = map.keys()
            while (keys.hasNext()) {
                val key = keys.next()
                val nested = map.optJSONObject(key) ?: continue
                val info = nested.optJSONObject("device_info") ?: nested.optJSONObject("deviceInfo") ?: nested
                add(
                    info.optString("id").ifBlank { info.optString("device_id") }.ifBlank { key },
                    info.optString("name").ifBlank { info.optString("device_name") },
                    info.optBoolean("is_active") || info.optBoolean("isActive"),
                )
            }
        }
        val activeId = root.optString("active_device_id").ifBlank { root.optString("activeDeviceId") }
        if (activeId.isNotBlank()) {
            return out.map { if (it.id == activeId) it.copy(active = true) else it }
        }
        return out
    }

    private fun parseSpclientHosts(raw: String): List<String> {
        val rec = runCatching { JSONObject(raw) }.getOrNull() ?: return emptyList()
        val list = rec.optJSONArray("spclient") ?: return emptyList()
        return buildList {
            for (i in 0 until list.length()) {
                val host = list.optString(i).trim()
                if (host.isBlank()) continue
                add(if (host.startsWith("http")) host.trimEnd('/') else "https://$host")
            }
        }
    }

    private data class DeviceQuery(
        val remoteName: String?,
        val devices: List<SpotifyDevice>,
        val selectedLocal: Boolean,
    )

    fun pause() {
        cancelActivePlay()
        eval("window.__spotifyBridge && window.__spotifyBridge.pause()")
    }

    fun resume() = playCurrent()

    fun seek(positionMs: Long) {
        eval("window.__spotifyBridge && window.__spotifyBridge.seek($positionMs)")
    }

    fun setVolume(volume: Float) {
        val fraction = volume.coerceIn(0f, 1f)
        eval("window.__spotifyBridge && window.__spotifyBridge.setVolume($fraction)")
    }

    fun pollState() {
        if (pageMutex.isLocked) return
        eval(
            """
            (function () {
              const s = window.__spotifyBridge?.getState?.();
              if (!s) return;
              MssSpotify.onState(JSON.stringify({
                ready: s.ready,
                playing: s.isPlaying,
                ad: false,
                positionMs: s.positionMs,
                durationMs: s.durationMs || 0,
                title: s.title || '',
                trackId: s.id || '',
              }));
            })();
            """.trimIndent(),
        )
    }

    private fun playCurrent() {
        eval("window.__spotifyBridge && window.__spotifyBridge.resume()")
    }

    private fun injectBridge() {
        val js = bridgeScript ?: loadBridgeScript() ?: return
        val view = webView ?: return
        main.post {
            view.onResume()
            view.resumeTimers()
            view.evaluateJavascript("!!window.__spotifyBridge") { ready ->
                if (ready != "true") {
                    view.evaluateJavascript(js) { eval(PATHFINDER_HOOK) }
                } else {
                    eval(PATHFINDER_HOOK)
                }
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
            view.evaluateJavascript("!!window.__spotifyBridge") { ready ->
                if (ready == "true") {
                    eval(PATHFINDER_HOOK)
                    if (!done.isCompleted) done.complete(Unit)
                } else {
                    view.evaluateJavascript(js) {
                        eval(PATHFINDER_HOOK)
                        if (!done.isCompleted) done.complete(Unit)
                    }
                }
            }
        }
        withTimeoutOrNull(4_000) { done.await() }
    }

    private fun rememberPathfinderUrl(url: String) {
        if (!url.contains("api-partner.spotify.com/pathfinder")) return
        runCatching {
            val parsed = android.net.Uri.parse(url)
            val operationName = parsed.getQueryParameter("operationName") ?: return
            val extensions = parsed.getQueryParameter("extensions") ?: return
            val obj = JSONObject(extensions)
            val hash = obj.optJSONObject("persistedQuery")?.optString("sha256Hash") ?: return
            rememberOperationHash(operationName, hash)
        }
    }

    private fun rememberPathfinderPost(raw: String) {
        runCatching {
            val obj = JSONObject(raw)
            val operationName = obj.optString("operationName")
            val hash = obj.optJSONObject("extensions")?.optJSONObject("persistedQuery")?.optString("sha256Hash")
            if (operationName.isNotBlank() && !hash.isNullOrBlank()) rememberOperationHash(operationName, hash)
        }
    }

    private fun loadBridgeScript(): String? {
        val view = webView ?: return null
        return runCatching {
            view.context.assets.open(BRIDGE_ASSET).bufferedReader().use { it.readText() }
        }.getOrNull()?.also { bridgeScript = it }
    }

    private fun jsonText(obj: JSONObject, key: String): String {
        if (!obj.has(key) || obj.isNull(key)) return ""
        return obj.optString(key).takeUnless { it.isBlank() || it == "null" || it == "undefined" }.orEmpty()
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
        fun onPathfinder(body: String) {
            rememberPathfinderPost(body)
        }

        @JavascriptInterface
        fun onHashes(id: String, json: String) {
            hashSniffWaiters.remove(id)?.complete(json)
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
                    title = jsonText(obj, "title"),
                    trackId = jsonText(obj, "trackId"),
                )
            }
        }
    }

    companion object {
        private const val BRIDGE_ASSET = "spotify-page-bridge.inject.js"
        private val HASH_RE = Regex("""[a-f0-9]{64}""", RegexOption.IGNORE_CASE)
        private val DEFAULT_QUERY_HASHES = mapOf(
            "searchDesktop" to "2aea208278ba99da84ae7401453e819af4e07769c3c23c11d38127955c6860ba",
            "searchTracks" to "1d021289df50166c61630e02f002ec91182b518e56bcd681ac6b0640390c0245",
            "addToLibrary" to "896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148",
            "removeFromLibrary" to "896ebcb47815681340860d121cb5d494e157e2a78d3950385cd54e0393c67148",
            "isInLibrary" to "d410781eb8ea7e1edce7c51368d5d2b6dca3c5391bd26b9ebca1cc9e1fadaddc",
            "areEntitiesInLibrary" to "134337999233cc6fdd6b1e6dbf94841409f04a946c5c7b744b09ba0dfe5a85ed",
        )
        private const val HOME = "https://open.spotify.com/"
        private const val APRESOLVE_URL = "https://apresolve.spotify.com/?type=spclient"
        private val FALLBACK_SPCLIENT = listOf("https://gew1-spclient.spotify.com", "https://spclient.wg.spotify.com")
        private val LOCAL_DEVICE_RE =
            Regex("this web browser|этот веб-браузер|этот браузер|this computer|этот компьютер|web player|веб-плеер", RegexOption.IGNORE_CASE)
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

        private val TRACK_ID_RE = Regex("""[A-Za-z0-9]{10,40}""")

        private const val PATHFINDER_HOOK = """
          (function () {
            if (window.__mssPathfinderHook) return;
            window.__mssPathfinderHook = true;
            const capture = (url, body) => {
              try {
                if (!url || url.indexOf('api-partner.spotify.com/pathfinder') < 0) return;
                if (typeof body === 'string' && body) {
                  MssSpotify.onPathfinder(body);
                  return;
                }
                const u = new URL(url, location.origin);
                const operationName = u.searchParams.get('operationName');
                const extensions = u.searchParams.get('extensions');
                if (operationName && extensions) {
                  MssSpotify.onPathfinder(JSON.stringify({
                    operationName: operationName,
                    extensions: JSON.parse(extensions),
                  }));
                }
              } catch (e) {}
            };
            const orig = window.fetch.bind(window);
            window.fetch = function (input, init) {
              try {
                const url = typeof input === 'string' ? input : (input && input.url) || '';
                capture(url, init && init.body);
              } catch (e) {}
              return orig(input, init);
            };
          })();
        """
    }
}
