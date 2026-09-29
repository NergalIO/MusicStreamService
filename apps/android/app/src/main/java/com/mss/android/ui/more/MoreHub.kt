package com.mss.android.ui.more

import android.annotation.SuppressLint
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CardMembership
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.unit.min
import androidx.compose.ui.viewinterop.AndroidView
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.HubRow
import com.mss.android.ui.components.ScreenTitle
import com.mss.android.ui.components.SectionTitle
import com.mss.android.ui.navigation.Routes
import com.mss.android.ui.theme.rememberMssWindow
import com.mss.core.model.SourceId

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun MoreHub(vm: MssViewModel, nav: NavHostController) {
    val ctx = LocalContext.current
    val window = rememberMssWindow()
    var vkOpen by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
        ScreenTitle("Ещё")
        HubRow("Настройки", "Качество, эквалайзер, API", Icons.Default.Settings) { nav.navigate(Routes.SETTINGS) }
        HubRow("Статистика", "Что вы слушали", Icons.Default.BarChart) { nav.navigate(Routes.STATS) }
        HubRow("Итоги года", "Wrapped", Icons.Default.Star) { nav.navigate(Routes.WRAPPED) }
        HubRow("Подписка", "План и промокод", Icons.Default.CardMembership) { nav.navigate(Routes.SUBSCRIPTION) }
        SectionTitle("Слушать")
        HubRow("Моя волна", "Радио по настроению", Icons.Default.Radio) { nav.navigate(Routes.WAVE) }
        HubRow("Лобби", "Слушать вместе", Icons.Default.Groups) { nav.navigate(Routes.LOBBY) }
        SectionTitle("Источники")
        HubRow("Spotify PKCE", "OAuth вход", Icons.Default.Star) {
            vm.connectSpotify { url -> CustomTabsIntent.Builder().build().launchUrl(ctx, Uri.parse(url)) }
        }
        HubRow("Spotify Web-плеер", "Скрытый WebView", Icons.Default.Star) { vm.showSpotifyLogin() }
        HubRow("Яндекс Музыка", "Device code", Icons.Default.Radio) { vm.connectYandex() }
        HubRow("VK Музыка", "Kate Mobile OAuth", Icons.Default.Groups) { vkOpen = true }
        HorizontalDivider(Modifier.padding(vertical = 8.dp))
        HubRow("Отключить Яндекс", "Выйти из аккаунта", Icons.AutoMirrored.Filled.Logout) { vm.disconnectSource(SourceId.YANDEX) }
        HubRow("Отключить Spotify", "Выйти из аккаунта", Icons.AutoMirrored.Filled.Logout) { vm.disconnectSource(SourceId.SPOTIFY) }
        HubRow("Отключить VK", "Выйти из аккаунта", Icons.AutoMirrored.Filled.Logout) { vm.disconnectSource(SourceId.VK) }
        HubRow("Выйти из MSS", "Сессия на этом устройстве", Icons.AutoMirrored.Filled.Logout) { vm.logout() }
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
                }, modifier = Modifier
                    .height(min(if (window.short) 200.dp else 400.dp, (window.heightDp * 0.42f).dp))
                    .fillMaxWidth())
            },
            confirmButton = { TextButton({ vkOpen = false }) { Text("Закрыть") } },
        )
    }
}
