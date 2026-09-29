package com.mss.android.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.mss.core.model.Quality

@Composable
fun SettingsScreen(vm: SettingsViewModel = hiltViewModel()) {
    val settings by vm.playbackSettings.collectAsState()
    val url by vm.apiBase.collectAsState()
    val apk by vm.apk.collectAsState()
    var api by remember { mutableStateOf(url) }
    LaunchedEffect(url) { api = url }
    LaunchedEffect(Unit) { vm.checkApk() }
    val bands = settings.eqBands.toMutableList().let { if (it.size < 8) it + List(8 - it.size) { 0f } else it }.take(8)
    val labels = listOf("60", "150", "400", "1k", "2.4k", "6k", "10k", "15k")
    Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedTextField(api, { api = it }, label = { Text("URL API") }, modifier = Modifier.fillMaxWidth())
        Button({ vm.setApiBase(api) }) { Text("Сохранить URL") }
        Text("Качество")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(settings.quality == Quality.NORMAL, { vm.setQuality(Quality.NORMAL) }, label = { Text("Обычное") })
            FilterChip(settings.quality == Quality.HIGH, { vm.setQuality(Quality.HIGH) }, label = { Text("Высокое") })
            FilterChip(settings.quality == Quality.LOSSLESS, { vm.setQuality(Quality.LOSSLESS) }, label = { Text("Lossless") })
        }
        Text("Акцент")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("violet" to "Фиолет", "teal" to "Бирюза", "amber" to "Янтарь").forEach { (id, label) ->
                FilterChip(settings.accent == id, { vm.savePlayback(settings.copy(accent = id)) }, label = { Text(label) })
            }
        }
        Text("Кроссфейд ${settings.crossfadeMs} мс")
        Slider(settings.crossfadeMs.toFloat(), { vm.savePlayback(settings.copy(crossfadeMs = it.toInt())) }, valueRange = 0f..12000f)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Эквалайзер", Modifier.weight(1f))
            Switch(settings.eqEnabled, { vm.savePlayback(settings.copy(eqEnabled = it)) })
        }
        if (settings.eqEnabled) {
            bands.forEachIndexed { i, v ->
                Text("${labels.getOrNull(i)} ${v.toInt()} dB")
                Slider(v, { next ->
                    val copy = bands.toMutableList()
                    copy[i] = next
                    vm.savePlayback(settings.copy(eqBands = copy))
                }, valueRange = -12f..12f)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Нормализация", Modifier.weight(1f))
            Switch(settings.normalize, { vm.savePlayback(settings.copy(normalize = it)) })
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Визуализатор", Modifier.weight(1f))
            Switch(settings.visualizer, { vm.savePlayback(settings.copy(visualizer = it)) })
        }
        Button({ vm.player.cycleRepeat() }) { Text("Repeat") }
        Button({ vm.player.setShuffle(!vm.player.state.value.shuffle) }) { Text("Shuffle") }
        Button({ vm.player.setSleepTimer(30) }) { Text("Sleep 30 мин") }
        Button({ vm.player.setSleepUntilEnd() }) { Text("Sleep до конца трека") }
        Button({ vm.player.setSleepTimer(null) }) { Text("Sleep выкл") }
        apk?.androidApkUrl?.let { Text("APK: $it (${apk?.version ?: ""})") }
    }
}
