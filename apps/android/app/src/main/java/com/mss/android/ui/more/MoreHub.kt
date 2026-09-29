package com.mss.android.ui.more

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.HubRow
import com.mss.android.ui.components.ScreenTitle
import com.mss.android.ui.components.SectionTitle
import com.mss.android.ui.navigation.Routes
import com.mss.core.connectors.AuthStatus
import com.mss.core.model.SourceId

@Composable
fun MoreHub(vm: MssViewModel, nav: NavHostController) {
    val sources by vm.sources.collectAsState()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
        ScreenTitle("Ещё")
        HubRow("Настройки", "Качество, оформление, сервер", Icons.Default.Settings) { nav.navigate(Routes.SETTINGS) }
        HubRow("Статистика", "Что вы слушали", Icons.Default.BarChart) { nav.navigate(Routes.STATS) }
        HubRow("Итоги года", "Wrapped", Icons.Default.Star) { nav.navigate(Routes.WRAPPED) }
        HubRow("Подписка", "План и промокод", Icons.Default.CardMembership) { nav.navigate(Routes.SUBSCRIPTION) }
        SectionTitle("Слушать")
        HubRow("Моя волна", "Радио по настроению", Icons.Default.Radio) { nav.navigate(Routes.WAVE) }
        HubRow("Лобби", "Слушать вместе", Icons.Default.Groups) { nav.navigate(Routes.LOBBY) }
        SectionTitle("Источники")
        SourceCard("Яндекс Музыка", sources.yandex, Icons.Default.Radio, connectedHint = "Подключено") {
            if (sources.yandex == AuthStatus.CONNECTED) vm.disconnectSource(SourceId.YANDEX) else vm.connectYandex()
        }
        SourceCard(
            "Spotify",
            sources.spotify,
            Icons.Default.Star,
            connectedHint = "Подключено · веб-плеер",
            disconnectedHint = "Вход через веб-плеер",
        ) {
            if (sources.spotify == AuthStatus.CONNECTED) vm.disconnectSource(SourceId.SPOTIFY) else vm.showSpotifyLogin()
        }
        SourceCard("VK Музыка", sources.vk, Icons.Default.Groups, connectedHint = "Подключено · токен на этом телефоне") {
            if (sources.vk == AuthStatus.CONNECTED) vm.disconnectSource(SourceId.VK) else vm.openVkLogin()
        }
        HubRow("Выйти из MSS", "Сессия на этом устройстве", Icons.AutoMirrored.Filled.Logout) { vm.logout() }
    }
    VkLoginDialog(vm)
}

@Composable
private fun SourceCard(
    title: String,
    status: AuthStatus,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    connectedHint: String,
    disconnectedHint: String = "Не подключено",
    onAction: () -> Unit,
) {
    val subtitle = when (status) {
        AuthStatus.CONNECTED -> connectedHint
        AuthStatus.EXPIRED -> "Нужен повторный вход"
        AuthStatus.DISCONNECTED -> disconnectedHint
    }
    val action = when (status) {
        AuthStatus.CONNECTED -> "Отключить"
        AuthStatus.EXPIRED -> "Войти заново"
        AuthStatus.DISCONNECTED -> "Войти"
    }
    HubRow(title, subtitle, icon, action = action, onAction = onAction)
}
