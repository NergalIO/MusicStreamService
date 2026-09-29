package com.mss.android.ui.stats

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import com.mss.android.ui.components.MssChip
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.theme.ChipFlow
import com.mss.core.model.toUnifiedTrack

@Composable
fun StatsScreen(vm: MssViewModel, initialPeriod: String = "month") {
    var period by remember { mutableStateOf(initialPeriod) }
    LaunchedEffect(period) { vm.loadStats(period) }
    val stats by vm.stats.collectAsState()
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        ChipFlow {
            listOf("week" to "Неделя", "month" to "Месяц", "year" to "Год", "all" to "Всё").forEach { (id, label) ->
                MssChip(period == id, label) { period = id }
            }
        }
        stats?.let {
            Text(
                "Минут: ${it.totalMinutes}, прослушиваний: ${it.totalPlays}, треков: ${it.uniqueTracks}",
                style = MaterialTheme.typography.bodyMedium,
            )
            Text("Топ треков", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            it.topTracks.take(10).forEach { t ->
                Text(
                    "• ${t.artist} — ${t.title} (${t.plays})",
                    modifier = Modifier.fillMaxWidth().clickable { vm.play(listOf(t.toUnifiedTrack())) }.padding(vertical = 4.dp),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text("Исполнители", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 12.dp))
            it.topArtists.take(10).forEach { a ->
                Text("• ${a.name} (${a.plays})", maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
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
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        sub?.let {
            Text("${it.planName} (${it.status})", maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text("Офлайн: ${it.features.offlineEnabled}, макс. ${it.features.maxOfflineTracks ?: "∞"}")
        }
        OutlinedTextField(code, { code = it }, label = { Text("Промокод") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Button({ vm.activatePromo(code) }, Modifier.fillMaxWidth()) { Text("Активировать") }
    }
}
