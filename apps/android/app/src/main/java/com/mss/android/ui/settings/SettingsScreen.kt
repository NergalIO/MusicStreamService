package com.mss.android.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.MssField
import com.mss.android.ui.components.SettingsRow
import com.mss.android.ui.components.SettingsSection
import com.mss.android.ui.theme.ACCENTS
import com.mss.android.ui.theme.AccentSwatches
import com.mss.android.ui.theme.COVER_ACCENT
import com.mss.android.ui.theme.ChipFlow
import com.mss.core.model.Quality

@Composable
fun SettingsScreen(vm: SettingsViewModel = hiltViewModel()) {
    val settings by vm.playbackSettings.collectAsState()
    val url by vm.apiBase.collectAsState()
    val apk by vm.apk.collectAsState()
    var api by remember { mutableStateOf(url) }
    LaunchedEffect(url) { api = url }
    LaunchedEffect(Unit) { vm.checkApk() }
    val qualityHint = when (settings.quality) {
        Quality.NORMAL -> "MP3 192 кбит/с — меньше трафика."
        Quality.HIGH -> "MP3 320 кбит/с."
        Quality.LOSSLESS -> "FLAC, если он есть у трека; иначе лучшее доступное качество."
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
        SettingsSection("Воспроизведение", qualityHint) {
            SettingsRow("Качество потока", "Для Яндекс Музыки") {
                ChipFlow {
                    MssChip(settings.quality == Quality.NORMAL, "Обычное") { vm.setQuality(Quality.NORMAL) }
                    MssChip(settings.quality == Quality.HIGH, "Высокое") { vm.setQuality(Quality.HIGH) }
                    MssChip(settings.quality == Quality.LOSSLESS, "Lossless") { vm.setQuality(Quality.LOSSLESS) }
                }
            }
            SettingsRow("Выравнивать громкость", "Треки звучат одинаково громко") {
                Switch(settings.normalize, { vm.savePlayback(settings.copy(normalize = it)) })
            }
        }
        SettingsSection("Экран") {
            SettingsRow("Визуализатор", "На экране «Сейчас играет»") {
                Switch(settings.visualizer, { vm.savePlayback(settings.copy(visualizer = it)) })
            }
        }
        SettingsSection(
            "Внешний вид",
            if (settings.accent == COVER_ACCENT) {
                "Подстраивается под обложку играющего трека"
            } else {
                ACCENTS.find { it.id == settings.accent }?.label ?: "Фиолетовый"
            },
        ) {
            AccentSwatches(settings.accent, onSelect = { id -> vm.savePlayback(settings.copy(accent = id)) })
        }
        SettingsSection("Сервер") {
            SettingsRow("Адрес сервера") {}
            MssField(api, { api = it }, placeholder = "https://…", label = "URL API", modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            Button({ vm.setApiBase(api) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) { Text("Сохранить") }
            apk?.version?.let { Text("Версия APK: $it", modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
        }
    }
}
