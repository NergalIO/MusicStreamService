package com.mss.android.ui.stats

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.Cover
import com.mss.android.ui.components.EmptyState
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.sourceLabel
import com.mss.android.ui.navigation.Routes
import com.mss.android.ui.navigation.openRoute
import com.mss.android.ui.theme.ChipFlow
import com.mss.core.model.ListeningStats
import com.mss.core.model.SourceId
import com.mss.core.model.StatsTopArtist
import com.mss.core.model.StatsTopTrack
import com.mss.core.model.toUnifiedTrack
import kotlin.math.ceil
import kotlin.math.roundToInt

private val PERIODS = listOf("week" to "Неделя", "month" to "Месяц", "year" to "Год", "all" to "Всё время")
private val MONTHS = listOf("янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек")

@Composable
fun StatsScreen(vm: MssViewModel, nav: NavHostController, initialPeriod: String = "month") {
    var period by remember { mutableStateOf(initialPeriod) }
    LaunchedEffect(period) { vm.loadStats(period) }
    val stats by vm.stats.collectAsState()
    val error by vm.statsError.collectAsState()
    val ready = stats?.takeIf { it.period == period }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(
            "Что и сколько вы слушаете во всех источниках",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        ChipFlow {
            PERIODS.forEach { (id, label) ->
                MssChip(period == id, label) { period = id }
            }
        }
        when {
            ready != null && ready.totalPlays == 0 -> EmptyState(
                "Пока нет прослушиваний",
                "Статистика появится, когда вы послушаете что-нибудь дольше 30 секунд на телефоне или компьютере. Прослушивания без сети сохранятся и отправятся позже.",
            )
            ready != null -> StatsBody(ready, vm, nav)
            error != null -> Column(Modifier.fillMaxWidth().padding(vertical = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Не удалось загрузить статистику", style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
                Text(
                    error ?: "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 8.dp),
                )
                TextButton({ vm.loadStats(period) }, Modifier.padding(top = 8.dp)) { Text("Повторить") }
            }
            else -> StatsSkeleton()
        }
    }
}

@Composable
private fun StatsBody(stats: ListeningStats, vm: MssViewModel, nav: NavHostController) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatCard(
                    "Время",
                    formatMinutes(stats.totalMinutes),
                    "${ruCount(stats.activeDays, "день", "дня", "дней")} с музыкой",
                    Modifier.weight(1f),
                )
                StatCard("Прослушивания", stats.totalPlays.toString(), null, Modifier.weight(1f))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StatCard(
                    "Треки",
                    stats.uniqueTracks.toString(),
                    ruCount(stats.uniqueArtists, "исполнитель", "исполнителя", "исполнителей"),
                    Modifier.weight(1f),
                )
                StatCard(
                    "Любимое время",
                    stats.peakHour?.let { "%02d:00".format(it) } ?: "—",
                    stats.peakHour?.let { "до %02d:00".format((it + 1) % 24) },
                    Modifier.weight(1f),
                )
            }
        }
        TimelineChart(stats)
        SourceShare(stats)
        if (stats.topTracks.isNotEmpty()) {
            Text("Топ треков", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            TopTracks(stats.topTracks.take(25), vm)
        }
        if (stats.topArtists.isNotEmpty()) {
            Text("Топ исполнителей", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            TopArtists(stats.topArtists.take(15), nav)
        }
    }
}

@Composable
private fun StatCard(label: String, value: String, hint: String?, modifier: Modifier = Modifier) {
    Column(
        modifier
            .defaultMinSize(minHeight = 92.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(14.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(
            value,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 4.dp),
        )
        if (!hint.isNullOrBlank()) {
            Text(
                hint,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

@Composable
private fun TimelineChart(stats: ListeningStats) {
    val series = stats.timeline
    if (series.isEmpty()) return
    val max = series.maxOf { it.minutes }.coerceAtLeast(1.0)
    val unit = stats.timelineUnit ?: "month"
    var selected by remember(stats.period, series.size) { mutableIntStateOf(-1) }
    val active = series.getOrNull(selected)
    val every = if (series.size > 16) ceil(series.size / 10.0).toInt().coerceAtLeast(1) else 1
    val scheme = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(scheme.surface).padding(14.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            Text("Минуты прослушивания", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            Text(
                if (active != null) "${bucketLabel(active.bucket, unit, long = true)} · ${formatMinutes(active.minutes.roundToInt())}"
                else "пик — ${formatMinutes(max.roundToInt())}",
                style = MaterialTheme.typography.labelSmall,
                color = scheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp).height(144.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            series.forEachIndexed { index, bucket ->
                val fraction = (bucket.minutes / max).toFloat().coerceIn(0f, 1f)
                val minFraction = if (bucket.minutes > 0) 0.03f else 0.012f
                Box(
                    Modifier
                        .weight(1f, fill = false)
                        .height(144.dp * fraction.coerceAtLeast(minFraction))
                        .clip(RoundedCornerShape(topStart = 3.dp, topEnd = 3.dp))
                        .background(
                            if (selected == index) scheme.primary
                            else scheme.primary.copy(alpha = if (bucket.minutes > 0) 0.55f else 0.22f),
                        )
                        .clickable { selected = if (selected == index) -1 else index },
                )
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            series.forEachIndexed { index, bucket ->
                Text(
                    if (index % every == 0) bucketLabel(bucket.bucket, unit) else "",
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.labelSmall,
                    color = scheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    maxLines = 1,
                )
            }
        }
    }
}

@Composable
private fun SourceShare(stats: ListeningStats) {
    val sources = stats.sources.filter { it.minutes > 0 }
    val total = sources.sumOf { it.minutes }
    if (total <= 0) return
    val scheme = MaterialTheme.colorScheme
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(scheme.surface).padding(14.dp)) {
        Text("Источники", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Row(
            Modifier.fillMaxWidth().padding(top = 12.dp).height(10.dp).clip(CircleShape).background(scheme.onSurface.copy(alpha = 0.07f)),
        ) {
            sources.forEach { source ->
                Box(
                    Modifier
                        .weight((source.minutes / total).toFloat().coerceAtLeast(0.01f))
                        .fillMaxHeight()
                        .background(sourceColor(source.source, scheme.primary)),
                )
            }
        }
        Column(Modifier.padding(top = 12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            sources.forEach { source ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(sourceColor(source.source, scheme.primary)))
                    Text(sourceLabel(source.source), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Medium)
                    Text("${(source.minutes / total * 100).roundToInt()}%", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun TopTracks(items: List<StatsTopTrack>, vm: MssViewModel) {
    val tracks = remember(items) { items.map { it.toUnifiedTrack() } }
    Column {
        tracks.forEachIndexed { index, track ->
            val stat = items[index]
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).clickable { vm.play(tracks, index) }.padding(vertical = 6.dp, horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    "${index + 1}",
                    modifier = Modifier.size(width = 22.dp, height = 20.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.End,
                )
                Cover(track.coverUrl, Modifier.size(40.dp), corner = 8.dp)
                Column(Modifier.weight(1f)) {
                    Text(track.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(track.artist, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text("${stat.plays}×", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
                    Text(formatMinutes(stat.minutes.roundToInt()), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}

@Composable
private fun TopArtists(items: List<StatsTopArtist>, nav: NavHostController) {
    Column {
        items.forEachIndexed { index, artist ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(12.dp))
                    .clickable {
                        nav.openRoute(Routes.artist(artist.name, artist.source.name.lowercase(), artist.id?.ifBlank { "-" } ?: "-"))
                    }
                    .padding(vertical = 6.dp, horizontal = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Text(
                    "${index + 1}",
                    modifier = Modifier.size(width = 22.dp, height = 20.dp),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.End,
                )
                Cover(artist.coverUrl, Modifier.size(40.dp), corner = 20.dp)
                Column(Modifier.weight(1f)) {
                    Text(artist.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(
                        formatPlays(artist.plays),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(formatMinutes(artist.minutes.roundToInt()), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun StatsSkeleton() {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SkeletonBox(Modifier.weight(1f).height(92.dp))
            SkeletonBox(Modifier.weight(1f).height(92.dp))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            SkeletonBox(Modifier.weight(1f).height(92.dp))
            SkeletonBox(Modifier.weight(1f).height(92.dp))
        }
        SkeletonBox(Modifier.fillMaxWidth().height(200.dp))
        repeat(4) { SkeletonBox(Modifier.fillMaxWidth().height(52.dp)) }
    }
}

@Composable
private fun SkeletonBox(modifier: Modifier) {
    Box(modifier.clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.onSurface.copy(alpha = 0.06f)))
}

private fun sourceColor(source: SourceId, primary: Color): Color = when (source) {
    SourceId.LOCAL -> primary
    SourceId.YANDEX -> Color(0xFFFBBF24)
    SourceId.SPOTIFY -> Color(0xFF10B981)
    SourceId.VK -> Color(0xFF0EA5E9)
}

private fun formatMinutes(minutes: Int): String {
    if (minutes < 60) return "$minutes мин"
    val hours = minutes / 60
    val rest = minutes % 60
    return if (rest == 0) "$hours ч" else "$hours ч $rest мин"
}

private fun formatPlays(count: Int): String = ruCount(count, "прослушивание", "прослушивания", "прослушиваний")

private fun ruCount(n: Int, one: String, few: String, many: String): String {
    val mod100 = n % 100
    val mod10 = n % 10
    val word = when {
        mod100 in 11..14 -> many
        mod10 == 1 -> one
        mod10 in 2..4 -> few
        else -> many
    }
    return "$n $word"
}

private fun bucketLabel(bucket: String, unit: String, long: Boolean = false): String {
    val parts = bucket.split("-")
    val month = parts.getOrNull(1)?.toIntOrNull()?.minus(1) ?: return bucket
    val name = MONTHS.getOrNull(month) ?: return bucket
    if (unit == "day") {
        val day = parts.getOrNull(2)?.toIntOrNull() ?: return bucket
        return if (long) "$day $name" else day.toString()
    }
    val year = parts.getOrNull(0) ?: return name
    return if (long) "$name $year" else name
}

@Composable
fun SubScreen(vm: MssViewModel) {
    val context = LocalContext.current
    val scheme = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text("Подписка", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Text(
            "MSS сейчас бесплатен для всех пользователей",
            style = MaterialTheme.typography.bodyMedium,
            color = scheme.onSurfaceVariant,
        )
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(scheme.primary.copy(alpha = 0.12f))
                .padding(20.dp),
        ) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(Icons.Default.AutoAwesome, null, tint = scheme.primary, modifier = Modifier.padding(top = 2.dp))
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(
                        "В данный момент подписка не предусмотрена, и доступен полный функционал программы.",
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = FontWeight.Medium,
                    )
                    Text(
                        "Все возможности MSS — внутренняя библиотека, подключение сервисов, офлайн, плейлисты и плеер — доступны без ограничений и без оплаты.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = scheme.onSurfaceVariant,
                    )
                }
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(16.dp))
                .background(scheme.surfaceVariant.copy(alpha = 0.45f))
                .padding(20.dp),
        ) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Icon(Icons.Default.Favorite, null, tint = scheme.primary)
                    Text("Будем рады поддержке", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                }
                Text(
                    "Если MSS помогает вам слушать музыку, можно поддержать разработку добровольным донатом через ЮMoney.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = scheme.onSurfaceVariant,
                )
                Button(
                    onClick = {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse("https://yoomoney.ru/to/4100118926337293/0"))
                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                        )
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text("Подарить")
                }
            }
        }
    }
}
