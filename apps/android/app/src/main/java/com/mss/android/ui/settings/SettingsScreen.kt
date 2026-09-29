package com.mss.android.ui.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Slider
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
import com.mss.android.ui.theme.ChipFlow
import com.mss.core.model.Quality

@Composable
fun SettingsScreen(vm: SettingsViewModel = hiltViewModel()) {
    val settings by vm.playbackSettings.collectAsState()
    val url by vm.apiBase.collectAsState()
    val apk by vm.apk.collectAsState()
    val player by vm.player.state.collectAsState()
    var api by remember { mutableStateOf(url) }
    LaunchedEffect(url) { api = url }
    LaunchedEffect(Unit) { vm.checkApk() }
    val bands = settings.eqBands.toMutableList().let { if (it.size < 8) it + List(8 - it.size) { 0f } else it }.take(8)
    val labels = listOf("60", "150", "400", "1k", "2.4k", "6k", "10k", "15k")
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
            val seconds = settings.crossfadeMs / 1000
            SettingsRow("Плавный переход", if (seconds == 0) "Выключен" else "$seconds с между треками") {
                Slider(
                    value = seconds.toFloat(),
                    onValueChange = { vm.savePlayback(settings.copy(crossfadeMs = it.toInt() * 1000)) },
                    valueRange = 0f..12f,
                    steps = 11,
                    modifier = Modifier.fillMaxWidth(0.45f),
                )
            }
            SettingsRow("Выравнивать громкость", "Треки звучат одинаково громко") {
                Switch(settings.normalize, { vm.savePlayback(settings.copy(normalize = it)) })
            }
        }
        SettingsSection("Звук") {
            SettingsRow("Эквалайзер") {
                Switch(settings.eqEnabled, { vm.savePlayback(settings.copy(eqEnabled = it)) })
            }
            if (settings.eqEnabled) {
                bands.forEachIndexed { i, v ->
                    SettingsRow("${labels.getOrNull(i)} Гц", "${v.toInt()} dB") {
                        Slider(v, { next ->
                            val copy = bands.toMutableList()
                            copy[i] = next
                            vm.savePlayback(settings.copy(eqBands = copy))
                        }, valueRange = -12f..12f, modifier = Modifier.fillMaxWidth(0.5f))
                    }
                }
            }
            SettingsRow("Визуализатор", "На экране «Сейчас играет»") {
                Switch(settings.visualizer, { vm.savePlayback(settings.copy(visualizer = it)) })
            }
        }
        SettingsSection("Внешний вид") {
            SettingsRow("Акцент") {
                ChipFlow {
                    listOf("violet" to "Фиолет", "teal" to "Бирюза", "amber" to "Янтарь").forEach { (id, label) ->
                        MssChip(settings.accent == id, label) { vm.savePlayback(settings.copy(accent = id)) }
                    }
                }
            }
        }
        SettingsSection("Таймер сна") {
            SettingsRow("Остановить воспроизведение") {
                ChipFlow {
                    MssChip(!player.sleepUntilTrackEnd && player.sleepEndsAt == null, "Выкл") { vm.player.setSleepTimer(null) }
                    MssChip(player.sleepEndsAt != null, "30 мин") { vm.player.setSleepTimer(30) }
                    MssChip(player.sleepUntilTrackEnd, "До конца трека") { vm.player.setSleepUntilEnd() }
                }
            }
        }
        SettingsSection("Сервер") {
            SettingsRow("Адрес сервера") {}
            MssField(api, { api = it }, placeholder = "https://…", label = "URL API", modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            Button({ vm.setApiBase(api) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) { Text("Сохранить") }
            apk?.version?.let { Text("Версия APK: $it", modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) }
        }
    }
}
