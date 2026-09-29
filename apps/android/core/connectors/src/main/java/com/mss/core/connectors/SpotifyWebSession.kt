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
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

data class SpotifyWebHeaders(
    val authorization: String,
    val clientToken: String,
    val appVersion: String = "",
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
class SpotifyWebSession @Inject constructor() {
    private val main = Handler(Looper.getMainLooper())
    private var webView: WebView? = null

    private val _loggedIn = MutableStateFlow(false)
    val loggedIn: StateFlow<Boolean> = _loggedIn

    private val _dom = MutableStateFlow(SpotifyDomState())
    val dom: StateFlow<SpotifyDomState> = _dom

    @Volatile var headers: SpotifyWebHeaders? = null
        private set

    private val _visibleForLogin = MutableStateFlow(false)
    val visibleForLogin: StateFlow<Boolean> = _visibleForLogin

    @Volatile private var hashes: Map<String, String> = emptyMap()
    private var loginAgent = false

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
                }
                return null
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                val cookies = CookieManager.getInstance().getCookie("https://open.spotify.com/")
                    ?: CookieManager.getInstance().getCookie("https://accounts.spotify.com/")
                    ?: ""
                _loggedIn.value = cookies.contains("sp_dc") || cookies.contains("sp_key")
                if (loginAgent) eval(FIT_MOBILE)
                injectHelpers()
                if (_loggedIn.value && !loginAgent) eval(SCAN_OPERATIONS)
            }
        }
        view.loadUrl("https://open.spotify.com/")
    }

    fun showLogin() {
        _visibleForLogin.value = true
        if (loginAgent) {
            eval("window.location.href='$LOGIN_URL'")
            return
        }
        loginAgent = true
        applyAgent(mobile = true, url = LOGIN_URL)
    }

    fun hideLogin() {
        _visibleForLogin.value = false
        if (!loginAgent) return
        loginAgent = false
        applyAgent(mobile = false, url = "https://open.spotify.com/")
    }

    private fun applyAgent(mobile: Boolean, url: String) {
        val view = webView ?: return
        main.post {
            view.settings.userAgentString = if (mobile) MOBILE_UA else DESKTOP_UA
            view.settings.loadWithOverviewMode = false
            view.isHorizontalScrollBarEnabled = false
            view.loadUrl(url)
        }
    }

    fun logout() {
        _visibleForLogin.value = false
        _loggedIn.value = false
        loginAgent = false
        headers = null
        hashes = emptyMap()
        main.post {
            CookieManager.getInstance().removeAllCookies(null)
            CookieManager.getInstance().flush()
            webView?.settings?.userAgentString = DESKTOP_UA
            webView?.loadUrl("https://open.spotify.com/")
        }
    }

    fun play(trackId: String, positionMs: Long = 0) {
        eval(
            """
            (async () => {
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
            })();
            """.trimIndent(),
        )
    }

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
        private const val DESKTOP_UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36"
        private const val MOBILE_UA =
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36"
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
    }
}
