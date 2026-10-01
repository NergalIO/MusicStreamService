package com.mss.android.ui.more

import android.annotation.SuppressLint
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import coil.compose.AsyncImage
import com.mss.android.ui.LoginPopupChrome
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.prepareLogin
import com.mss.android.ui.VkLoginStep
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.MssField
import com.mss.android.ui.theme.ChipFlow
import com.mss.core.connectors.VkAuth

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun VkLoginDialog(vm: MssViewModel) {
    val ui by vm.vkLogin.collectAsState()
    if (!ui.open || ui.step == VkLoginStep.VKID) return
    var phone by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var captcha by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = { if (!ui.busy) vm.closeVkLogin() },
        title = { Text("VK Музыка") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ChipFlow {
                    MssChip(ui.sms && ui.step != VkLoginStep.VKID, "SMS") { vm.setVkMethod(true) }
                    MssChip(!ui.sms && ui.step != VkLoginStep.VKID, "Пароль") { vm.setVkMethod(false) }
                    MssChip(false, "VK ID") { vm.openVkIdLogin() }
                }
                ui.error?.let { Text(it, color = androidx.compose.material3.MaterialTheme.colorScheme.error) }
                when {
                    ui.step == VkLoginStep.CAPTCHA -> {
                        ui.captchaImg?.let { AsyncImage(it, contentDescription = "Капча", modifier = Modifier.height(64.dp)) }
                        MssField(captcha, { captcha = it }, placeholder = "Символы с картинки", label = "Капча")
                    }
                    ui.step == VkLoginStep.CODE -> {
                        ui.phoneMask?.let { Text("Код отправлен на $it") }
                        MssField(
                            code,
                            { code = it },
                            placeholder = "Код из SMS",
                            label = "Код",
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        )
                    }
                    ui.sms -> {
                        MssField(
                            phone,
                            { phone = it },
                            placeholder = "+7…",
                            label = "Телефон",
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        )
                    }
                    else -> {
                        MssField(username, { username = it }, placeholder = "Телефон или email", label = "Логин")
                        MssField(
                            password,
                            { password = it },
                            placeholder = "Пароль не сохраняется",
                            label = "Пароль",
                            visualTransformation = PasswordVisualTransformation(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                        )
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !ui.busy,
                onClick = {
                    when {
                        ui.step == VkLoginStep.CAPTCHA && ui.sms -> vm.submitVkPhone(phone, captcha)
                        ui.step == VkLoginStep.CAPTCHA -> vm.submitVkPassword(username, password, code.ifBlank { null }, captcha)
                        ui.step == VkLoginStep.CODE && ui.sms -> vm.submitVkSms(code)
                        ui.step == VkLoginStep.CODE -> vm.submitVkPassword(username, password, code)
                        ui.sms -> vm.submitVkPhone(phone)
                        else -> vm.submitVkPassword(username, password)
                    }
                },
            ) { Text(if (ui.busy) "Входим…" else "Продолжить") }
        },
        dismissButton = {
            TextButton(onClick = { vm.closeVkLogin() }, enabled = !ui.busy) { Text("Отмена") }
        },
    )
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun VkIdOverlay(
    error: String?,
    startUrl: String?,
    confirmUrl: String?,
    onClose: () -> Unit,
    onForm: () -> Unit,
    onDone: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var pageError by remember { mutableStateOf<String?>(null) }
    Column(
        modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .statusBarsPadding()
            .imePadding()
            .navigationBarsPadding(),
    ) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("VK Музыка", modifier = Modifier.weight(1f).padding(start = 8.dp), style = MaterialTheme.typography.titleMedium)
            TextButton(onClick = onForm) { Text("SMS / пароль") }
            TextButton(onClick = onClose) { Text("Закрыть") }
        }
        Text(
            "Войдите в VK как обычно. После входа подтвердите доступ к музыке — обычный VK ID музыку не отдаёт.",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 2.dp),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        (pageError ?: error)?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        if (startUrl.isNullOrBlank()) {
            Box(
                Modifier.fillMaxWidth().weight(1f),
                contentAlignment = Alignment.Center,
            ) {
                if (error.isNullOrBlank()) CircularProgressIndicator()
            }
            return@Column
        }
        AndroidView(
            factory = { ctx ->
                android.widget.FrameLayout(ctx).apply {
                    setBackgroundColor(android.graphics.Color.WHITE)
                    val web = WebView(ctx)
                    addView(
                        web,
                        android.widget.FrameLayout.LayoutParams(
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        ),
                    )
                    web.prepareLogin(VkAuth.MOBILE_UA)
                    var deliverConnect: ((String, String) -> Unit)? = null
                    web.addJavascriptInterface(object {
                        @JavascriptInterface
                        fun onConnect(appId: String, body: String) {
                            web.post { deliverConnect?.invoke(appId, body) }
                        }
                    }, "MssVk")
                    web.webViewClient = object : WebViewClient() {
                        private var finished = false
                        private var fellBack = false
                        private var openedConfirm = false
                        private var connecting = false
                        private var connectAttempts = 0
                        private var lastConnectAt = 0L
                        private val musicConfirm = confirmUrl.orEmpty()
                        private val skipConnect = musicConfirm.isNotBlank()

                        init {
                            deliverConnect = { appId, body ->
                                val payload = vkConnectPayload(body)
                                when {
                                    payload != null && appId == VkAuth.KATE_CLIENT_ID -> {
                                        connecting = false
                                        acceptOAuth(VkAuth.toRedirectUrl(payload))
                                    }
                                    payload != null && appId == VkAuth.ANDROID_CLIENT_ID && !skipConnect -> {
                                        connecting = false
                                        acceptOAuth(VkAuth.toRedirectUrl(payload))
                                    }
                                    appId == VkAuth.KATE_CLIENT_ID && !finished && !skipConnect ->
                                        web.evaluateJavascript(vkConnectScript(VkAuth.ANDROID_CLIENT_ID), null)
                                    else -> connecting = false
                                }
                            }
                        }

                        private fun tryConnect(target: WebView) {
                            if (skipConnect) return
                            val now = android.os.SystemClock.elapsedRealtime()
                            if (finished || connecting || connectAttempts >= MAX_CONNECT_ATTEMPTS) return
                            if (now - lastConnectAt < CONNECT_INTERVAL_MS) return
                            connecting = true
                            connectAttempts++
                            lastConnectAt = now
                            target.evaluateJavascript(vkConnectScript(VkAuth.KATE_CLIENT_ID), null)
                        }

                        private fun acceptOAuth(url: String): Boolean {
                            if (finished || !VkAuth.shouldCompleteWebLogin(url)) return false
                            finished = true
                            onDone(url)
                            return true
                        }

                        private fun inspect(view: WebView?, url: String?) {
                            if (finished) return
                            val candidate = url.orEmpty()
                            if (acceptOAuth(candidate)) return
                            val target = view ?: return
                            target.evaluateJavascript(FIT_PHONE, null)
                            target.evaluateJavascript(READ_PAGE) { raw ->
                                if (finished) return@evaluateJavascript
                                val snap = pageSnap(raw)
                                val href = snap.href.ifBlank { candidate }
                                if (acceptOAuth(href)) return@evaluateJavascript
                                if (!fellBack && snap.text.contains("direct auth", true)) {
                                    fellBack = true
                                    target.loadUrl(startUrl)
                                    return@evaluateJavascript
                                }
                                val scraped = VkAuth.parsePageTokens(snap.html.ifBlank { snap.text })
                                if (scraped != null && acceptOAuth(VkAuth.toRedirectUrl(scraped))) return@evaluateJavascript
                                val host = runCatching { java.net.URI(href.ifBlank { candidate }).host.orEmpty() }.getOrDefault("")
                                if (!VkAuth.isVkHost(host) || !vkLoggedIn()) return@evaluateJavascript
                                if (musicConfirm.isNotBlank() && !openedConfirm && !isQrConfirmHost(host) &&
                                    !host.contains("oauth.vk", true) && vkLoggedIn()
                                ) {
                                    openedConfirm = true
                                    target.loadUrl(musicConfirm)
                                    return@evaluateJavascript
                                }
                                if (musicConfirm.isNotBlank()) return@evaluateJavascript
                                if (!openedConfirm && !VkAuth.looksLoggedIn(href) && !VkAuth.looksLoggedIn(candidate)) {
                                    openedConfirm = true
                                    target.loadUrl(if (host.endsWith("vk.ru", true)) "https://vk.ru/" else "https://vk.com/")
                                    return@evaluateJavascript
                                }
                                tryConnect(target)
                            }
                        }

                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                            val u = request?.url?.toString() ?: return false
                            return acceptOAuth(u)
                        }

                        override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                            if (url != null) acceptOAuth(url)
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            pageError = null
                            inspect(view, url)
                        }

                        override fun doUpdateVisitedHistory(view: WebView?, url: String?, isReload: Boolean) {
                            super.doUpdateVisitedHistory(view, url, isReload)
                            inspect(view, url)
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            err: android.webkit.WebResourceError,
                        ) {
                            if (!request.isForMainFrame) return
                            if (!fellBack && (request.url?.host?.contains("oauth.vk") == true)) {
                                fellBack = true
                                view.loadUrl(startUrl)
                                return
                            }
                            pageError = err.description?.toString() ?: "Не удалось открыть VK"
                        }
                    }
                    web.webChromeClient = LoginPopupChrome(this, VkAuth.MOBILE_UA)
                    web.loadUrl(startUrl)
                    web.requestFocus()
                }
            },
            modifier = Modifier.fillMaxWidth().weight(1f),
            onRelease = { frame ->
                for (i in frame.childCount - 1 downTo 0) {
                    (frame.getChildAt(i) as? WebView)?.destroy()
                }
            },
        )
    }
}

private const val FIT_PHONE = """
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

private const val READ_PAGE = """
  (function(){
    return {
      href: String(location.href || ''),
      text: String(document.body && document.body.innerText || '').slice(0, 800),
      html: String(document.documentElement && document.documentElement.innerHTML || '').slice(0, 80000)
    };
  })();
"""

private fun jsString(raw: String?): String {
    if (raw.isNullOrBlank() || raw == "null") return ""
    return runCatching { org.json.JSONTokener(raw).nextValue() as? String ?: "" }.getOrDefault("")
}

private data class PageSnap(val href: String = "", val text: String = "", val html: String = "")

private fun pageSnap(raw: String?): PageSnap {
    if (raw.isNullOrBlank() || raw == "null") return PageSnap()
    return runCatching {
        val obj = org.json.JSONObject(raw)
        PageSnap(
            href = obj.optString("href"),
            text = obj.optString("text"),
            html = obj.optString("html"),
        )
    }.getOrElse {
        PageSnap(href = jsString(raw))
    }
}

private fun vkConnectScript(appId: String): String = """
  fetch((/(^|\.)vk\.ru$/.test(location.hostname) ? 'https://login.vk.ru' : 'https://login.vk.com') + '/?act=connect_internal', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'app_id=$appId&oauth_version=1&version=1'
  }).then((r) => r.text()).catch(() => '').then((t) => { try { MssVk.onConnect('$appId', t); } catch (e) {} });
"""

private const val MAX_CONNECT_ATTEMPTS = 3
private const val CONNECT_INTERVAL_MS = 5_000L

private fun vkConnectPayload(body: String): com.mss.core.connectors.VkOAuthPayload? {
    val obj = runCatching { org.json.JSONObject(body) }.getOrNull() ?: return null
    val data = obj.optJSONObject("data") ?: obj
    fun str(key: String): String? {
        if (!data.has(key) || data.isNull(key)) return null
        val value = data.optString(key)
        return value.takeIf { it.isNotBlank() && it != "null" }
    }
    val access = str("access_token")
    val silent = str("silent_token")
    if (access == null && silent == null) return null
    val user = if (data.has("user_id") && !data.isNull("user_id")) data.optLong("user_id") else null
    return com.mss.core.connectors.VkOAuthPayload(access, user, silent, str("uuid") ?: str("silent_token_uuid"))
}

private fun isQrConfirmHost(host: String): Boolean = host.contains("qr.vk", true)

private fun vkLoggedIn(): Boolean {
    val cookies = CookieManager.getInstance()
    fun read(vararg urls: String) = urls.mapNotNull { cookies.getCookie(it)?.takeIf(String::isNotBlank) }.joinToString("; ")
    return VkAuth.hasSessionCookie(read("https://vk.ru/", "https://vk.com/", "https://m.vk.ru/", "https://m.vk.com/")) ||
        VkAuth.hasLoginCookie(read("https://login.vk.ru/", "https://login.vk.com/"))
}
