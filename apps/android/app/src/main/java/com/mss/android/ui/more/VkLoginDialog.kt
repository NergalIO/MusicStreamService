package com.mss.android.ui.more

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
                    MssChip(ui.sms, "SMS") { vm.setVkMethod(true) }
                    MssChip(!ui.sms, "Пароль") { vm.setVkMethod(false) }
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
fun VkIdOverlay(error: String?, onClose: () -> Unit, onDone: (String) -> Unit, modifier: Modifier = Modifier) {
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
            TextButton(onClick = onClose) { Text("Закрыть") }
        }
        (pageError ?: error)?.let {
            Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
        }
        AndroidView(
            factory = { ctx ->
                android.widget.FrameLayout(ctx).apply {
                    setBackgroundColor(android.graphics.Color.WHITE)
                    val web = WebView(ctx)
                    addView(web, android.widget.FrameLayout.LayoutParams(
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
                    ))
                    web.prepareLogin(VkAuth.MOBILE_UA)
                    web.webViewClient = object : WebViewClient() {
                        private var finished = false
                        private var fellBack = false

                        private fun finish(url: String) {
                            if (finished || !url.contains("blank.html")) return
                            finished = true
                            onDone(url)
                        }

                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                            val u = request?.url?.toString() ?: return false
                            if (u.contains("blank.html")) {
                                finish(u)
                                return true
                            }
                            return false
                        }

                        override fun onPageFinished(view: WebView?, url: String?) {
                            pageError = null
                            view?.evaluateJavascript(FIT_PHONE, null)
                            view?.evaluateJavascript(
                                "(function(){return (document.body&&document.body.innerText||'').slice(0,400)})()",
                            ) { raw ->
                                val text = raw?.trim('"').orEmpty()
                                if (!fellBack && text.contains("direct auth", true)) {
                                    fellBack = true
                                    view.loadUrl(VkAuth.ID_LOGIN)
                                }
                            }
                            if (url != null) finish(url)
                        }

                        override fun onReceivedError(
                            view: WebView,
                            request: WebResourceRequest,
                            err: android.webkit.WebResourceError,
                        ) {
                            if (!request.isForMainFrame) return
                            if (!fellBack && (request.url?.host?.contains("oauth.vk") == true)) {
                                fellBack = true
                                view.loadUrl(VkAuth.ID_LOGIN)
                                return
                            }
                            pageError = err.description?.toString() ?: "Не удалось открыть VK"
                        }
                    }
                    web.webChromeClient = LoginPopupChrome(this, VkAuth.MOBILE_UA)
                    web.loadUrl(VkAuth.mobileAuthorizeUrl())
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
