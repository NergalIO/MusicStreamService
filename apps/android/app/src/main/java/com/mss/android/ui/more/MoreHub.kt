package com.mss.android.ui.more

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.navigation.Routes
import com.mss.core.model.SourceId

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MoreHub(vm: MssViewModel, nav: NavHostController) {
    val ctx = LocalContext.current
    var vkOpen by remember { mutableStateOf(false) }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button({ nav.navigate(Routes.SETTINGS) }, Modifier.fillMaxWidth()) { Text("Настройки") }
        Button({ nav.navigate(Routes.STATS) }, Modifier.fillMaxWidth()) { Text("Статистика") }
        Button({ nav.navigate(Routes.WRAPPED) }, Modifier.fillMaxWidth()) { Text("Итоги года") }
        Button({ nav.navigate(Routes.SUBSCRIPTION) }, Modifier.fillMaxWidth()) { Text("Подписка") }
        Button({ nav.navigate(Routes.WAVE) }, Modifier.fillMaxWidth()) { Text("Моя волна") }
        Button({ nav.navigate(Routes.LOBBY) }, Modifier.fillMaxWidth()) { Text("Лобби") }
        Button({
            vm.connectSpotify { url -> CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(url)) }
        }, Modifier.fillMaxWidth()) { Text("Spotify PKCE") }
        Button({ vm.showSpotifyLogin() }, Modifier.fillMaxWidth()) { Text("Spotify Web-плеер") }
        Button({ vm.connectYandex() }, Modifier.fillMaxWidth()) { Text("Подключить Яндекс") }
        Button({ vkOpen = true }, Modifier.fillMaxWidth()) { Text("Подключить VK") }
        Button({ vm.disconnectSource(SourceId.YANDEX) }, Modifier.fillMaxWidth()) { Text("Отключить Яндекс") }
        Button({ vm.disconnectSource(SourceId.SPOTIFY) }, Modifier.fillMaxWidth()) { Text("Отключить Spotify") }
        Button({ vm.disconnectSource(SourceId.VK) }, Modifier.fillMaxWidth()) { Text("Отключить VK") }
        Button({ vm.logout() }, Modifier.fillMaxWidth()) { Text("Выйти") }
    }
    if (vkOpen) {
        AlertDialog(
            onDismissRequest = { vkOpen = false },
            title = { Text("VK") },
            text = {
                AndroidView(factory = { c ->
                    WebView(c).apply {
                        settings.javaScriptEnabled = true
                        webViewClient = object : WebViewClient() {
                            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                                val u = request?.url?.toString() ?: return false
                                if (u.contains("blank.html")) {
                                    vm.completeVk(u)
                                    vkOpen = false
                                    return true
                                }
                                return false
                            }
                        }
                        loadUrl(vm.vkAuthUrl())
                    }
                }, modifier = Modifier.height(400.dp).fillMaxWidth())
            },
            confirmButton = { TextButton({ vkOpen = false }) { Text("Закрыть") } },
        )
    }
}
