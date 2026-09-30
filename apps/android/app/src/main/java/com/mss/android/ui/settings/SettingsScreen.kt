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
import com.mss.android.data.CacheSettings
import androidx.compose.material3.OutlinedButton

private fun formatMb(bytes: Long): String {
    val mb = bytes / (1024.0 * 1024.0)
    return when {
        mb >= 1000 -> String.format(java.util.Locale.US, "%.1f ГБ", mb / 1024)
        mb >= 10 -> "${mb.toInt()} МБ"
        else -> String.format(java.util.Locale.US, "%.1f МБ", mb)
    }
}

@Composable
fun SettingsScreen(vm: SettingsViewModel = hiltViewModel()) {
    val settings by vm.playbackSettings.collectAsState()
    val url by vm.apiBase.collectAsState()
    val cache by vm.cache.collectAsState()
    val update by vm.updater.state.collectAsState()
    val autoUpdate by vm.autoUpdate.collectAsState()
    var api by remember { mutableStateOf(url) }
    LaunchedEffect(url) { api = url }
    LaunchedEffect(Unit) { vm.refreshCache() }
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
        SettingsSection(
            "Кеш",
            if (cache.restartNeeded) "Новый лимит для обложек применится после перезапуска приложения"
            else "Обложки, фото исполнителей, альбомы и тексты песен открываются без интернета",
        ) {
            SettingsRow(
                "Занято",
                cache.bytes?.let { "${formatMb(it)} из ${formatMb(cache.limitMb * 1024L * 1024L)}" } ?: "…",
            ) {
                OutlinedButton({ vm.clearCache() }, enabled = !cache.clearing && (cache.bytes ?: 0L) > 0L) {
                    Text(if (cache.clearing) "Очищаем…" else "Очистить")
                }
            }
            SettingsRow("Лимит размера") {
                ChipFlow {
                    CacheSettings.LIMITS_MB.forEach { mb ->
                        MssChip(cache.limitMb == mb, if (mb >= 1000) "${mb / 1000} ГБ" else "$mb МБ") { vm.setCacheLimit(mb) }
                    }
                }
            }
        }
        SettingsSection("Тестовые функции", "Могут работать нестабильно — при сбое отключите") {
            SettingsRow("Быстрый старт Spotify", "Трек запускается одним запросом к Spotify, без переходов в веб-плеере") {
                Switch(settings.spotifyFastStart, { vm.savePlayback(settings.copy(spotifyFastStart = it)) })
            }
        }
        SettingsSection("Сервер") {
            SettingsRow("Адрес сервера") {}
            MssField(api, { api = it }, placeholder = "https://…", label = "URL API", modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            Button({ vm.setApiBase(api) }, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) { Text("Сохранить") }
        }
        SettingsSection("Обновления") {
            val status = when {
                update.checking -> "Проверяем…"
                update.progress != null -> "Скачиваем ${((update.progress ?: 0f) * 100).toInt()}%"
                update.available -> "Доступна версия ${update.latest}"
                update.error != null -> update.error
                update.upToDate -> "Установлена последняя версия"
                else -> null
            }
            SettingsRow("Версия ${update.current}", status) {
                if (update.available) {
                    Button({ vm.updater.download() }, enabled = update.progress == null) { Text("Обновить") }
                } else {
                    OutlinedButton({ vm.updater.checkNow() }, enabled = !update.checking) { Text("Проверить") }
                }
            }
            SettingsRow("Проверять при запуске", "Предлагать установить новую версию") {
                Switch(autoUpdate, { vm.setAutoUpdate(it) })
            }
        }
    }
}
