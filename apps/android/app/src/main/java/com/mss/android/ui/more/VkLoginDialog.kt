package com.mss.android.ui.more

import android.annotation.SuppressLint
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import coil.compose.AsyncImage
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.VkLoginStep
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.MssField
import com.mss.android.ui.theme.ChipFlow
import com.mss.core.connectors.VkAuth

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun VkLoginDialog(vm: MssViewModel) {
    val ui by vm.vkLogin.collectAsState()
    if (!ui.open) return
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
                    ui.step == VkLoginStep.VKID -> {
                        Text("VK просит вход на своей странице. Войдите по номеру и коду из SMS.")
                        AndroidView(
                            factory = { ctx ->
                                WebView(ctx).apply {
                                    settings.javaScriptEnabled = true
                                    webViewClient = object : WebViewClient() {
                                        override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                            val u = request?.url?.toString() ?: return false
                                            if (u.contains("blank.html")) {
                                                vm.completeVkId(u)
                                                return true
                                            }
                                            return false
                                        }
                                    }
                                    loadUrl(VkAuth.ID_LOGIN)
                                }
                            },
                            modifier = Modifier.fillMaxWidth().height(360.dp),
                        )
                    }
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
            if (ui.step == VkLoginStep.VKID) {
                TextButton(onClick = { vm.closeVkLogin() }) { Text("Закрыть") }
            } else {
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
            }
        },
        dismissButton = {
            TextButton(onClick = { vm.closeVkLogin() }, enabled = !ui.busy) { Text("Отмена") }
        },
    )
}
