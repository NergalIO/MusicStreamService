package com.mss.android.ui.stats

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mss.android.ui.MssViewModel
import com.mss.core.model.toUnifiedTrack

@Composable
fun StatsScreen(vm: MssViewModel) {
    LaunchedEffect(Unit) { vm.loadStats() }
    val stats by vm.stats.collectAsState()
    Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState())) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button({ vm.loadStats("week") }) { Text("Неделя") }
            Button({ vm.loadStats("month") }) { Text("Месяц") }
            Button({ vm.loadStats("year") }) { Text("Год") }
            Button({ vm.loadStats("all") }) { Text("Всё") }
        }
        stats?.let {
            Text("Минут: ${it.totalMinutes}, прослушиваний: ${it.totalPlays}, треков: ${it.uniqueTracks}")
            Text("Топ треков", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            it.topTracks.take(10).forEach { t ->
                Text("• ${t.artist} — ${t.title} (${t.plays})", modifier = Modifier.clickable {
                    vm.play(listOf(t.toUnifiedTrack()))
                })
            }
            Text("Исполнители", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            it.topArtists.take(10).forEach { a -> Text("• ${a.name} (${a.plays})") }
            if (it.timeline.isNotEmpty()) {
                Text("Таймлайн", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
                it.timeline.take(24).forEach { b -> Text("${b.bucket}: ${b.minutes} мин") }
            }
        } ?: Text("Загрузка…")
    }
}

@Composable
fun SubScreen(vm: MssViewModel) {
    LaunchedEffect(Unit) { vm.loadSubscription() }
    val sub by vm.subscription.collectAsState()
    var code by remember { mutableStateOf("") }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        sub?.let {
            Text("${it.planName} (${it.status})")
            Text("Офлайн: ${it.features.offlineEnabled}, макс. ${it.features.maxOfflineTracks ?: "∞"}")
        }
        OutlinedTextField(code, { code = it }, label = { Text("Промокод") }, modifier = Modifier.fillMaxWidth())
        Button({ vm.activatePromo(code) }) { Text("Активировать") }
    }
}
