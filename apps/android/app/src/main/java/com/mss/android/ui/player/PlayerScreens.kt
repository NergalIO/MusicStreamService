package com.mss.android.ui.player

import android.media.audiofx.Visualizer
import android.os.Handler
import android.os.Looper
import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import coil.compose.AsyncImage
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.Cover
import com.mss.android.ui.components.TrackRow
import com.mss.android.ui.theme.MssTheme
import com.mss.core.model.LobbyDto
import com.mss.core.player.RepeatMode

@Composable
fun LobbyBar(lobby: LobbyDto?, onOpen: () -> Unit) {
    if (lobby == null) return
    val scheme = MaterialTheme.colorScheme
    Row(
        Modifier
            .fillMaxWidth()
            .background(scheme.primary.copy(alpha = 0.12f))
            .clickable(onClick = onOpen)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Лобби: ${lobby.title}", style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(end = 8.dp))
        Text(lobby.inviteCode, style = MaterialTheme.typography.labelMedium, color = scheme.primary, maxLines = 1)
    }
}

@Composable
fun MiniPlayer(vm: MssViewModel, onOpen: () -> Unit) {
    val state by vm.playerState.collectAsState()
    val track = state.current ?: return
    val scheme = MaterialTheme.colorScheme
    val progress = if (state.durationMs == 0L) 0f else (state.positionMs / state.durationMs.toFloat()).coerceIn(0f, 1f)
    Column(Modifier.fillMaxWidth().background(scheme.surfaceContainer)) {
        Box(Modifier.fillMaxWidth().height(2.dp).background(scheme.onSurface.copy(alpha = 0.12f))) {
            Box(Modifier.fillMaxHeight().fillMaxWidth(progress).background(scheme.onSurface))
        }
        Row(
            Modifier.fillMaxWidth().height(64.dp).clickable(onClick = onOpen).padding(horizontal = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Cover(track.coverUrl, Modifier.size(44.dp))
            Column(Modifier.weight(1f)) {
                Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                Text(track.artist, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            IconButton({ vm.player.prev() }) {
                Icon(Icons.Default.SkipPrevious, "Предыдущий", tint = scheme.onSurface.copy(alpha = 0.85f))
            }
            Box(
                Modifier
                    .size(48.dp)
                    .semantics { contentDescription = if (state.playing) "Пауза" else "Играть" }
                    .clickable { vm.player.toggle() },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    Modifier.size(36.dp).clip(CircleShape).background(scheme.onSurface),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (state.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = scheme.surfaceContainer,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }
            IconButton({ vm.player.next() }) {
                Icon(Icons.Default.SkipNext, "Следующий", tint = scheme.onSurface.copy(alpha = 0.85f))
            }
        }
    }
}

@Composable
fun NowPlayingScreen(vm: MssViewModel, onBack: () -> Unit = {}, onArtist: (String) -> Unit = {}) {
    val settings by vm.playbackSettings.collectAsState()
    MssTheme(accent = settings.accent, dark = true) {
        NowPlayingBody(vm, onBack, onArtist)
    }
}

@Composable
private fun NowPlayingBody(vm: MssViewModel, onBack: () -> Unit, onArtist: (String) -> Unit) {
    val state by vm.playerState.collectAsState()
    val lyrics by vm.lyrics.collectAsState()
    val liked by vm.likedIds.collectAsState()
    val settings by vm.playbackSettings.collectAsState()
    val track = state.current
    Box(Modifier.fillMaxSize()) {
        PlayerBackdrop(track?.coverUrl)
        if (track == null) {
            Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Ничего не играет", style = MaterialTheme.typography.titleMedium)
                Text(
                    "Выберите трек на главной или в медиатеке",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp),
                    textAlign = TextAlign.Center,
                )
                TextButton(onClick = onBack) { Text("Назад") }
            }
            return@Box
        }
        var tab by remember { mutableIntStateOf(1) }
        LaunchedEffect(track.id) { vm.loadLyrics(track) }
        val scheme = MaterialTheme.colorScheme
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val landscape = maxWidth > maxHeight
            val cover = min(min(maxWidth - 48.dp, 320.dp), if (landscape) maxHeight * 0.5f else maxHeight * 0.36f)
            val showVisualizer = settings.visualizer && !landscape && maxHeight > 640.dp
            Column(Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 8.dp)) {
                IconButton(onBack) {
                    Icon(Icons.Default.KeyboardArrowDown, "Свернуть", tint = scheme.onSurface)
                }
                if (landscape) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                        Cover(track.coverUrl, Modifier.size(cover), corner = 16.dp)
                        Column(Modifier.weight(1f)) {
                            TrackHeading(track.title, track.artist, track.id in liked, { vm.toggleLike(track) }, { onArtist(track.artist) })
                            NowPlayingControls(vm, state)
                        }
                    }
                } else {
                    Cover(track.coverUrl, Modifier.size(cover).align(Alignment.CenterHorizontally), corner = 16.dp)
                    TrackHeading(
                        track.title,
                        track.artist,
                        track.id in liked,
                        { vm.toggleLike(track) },
                        { onArtist(track.artist) },
                        Modifier.padding(top = 20.dp),
                    )
                    if (showVisualizer) SessionVisualizer(vm.player.audioSessionId())
                    NowPlayingControls(vm, state)
                }
                PlayerTabs(tab, onTab = { index -> tab = index }, onSimilar = { vm.loadSimilar(track) })
                when (tab) {
                    0 -> LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                        items(state.queue.size) { i ->
                            val t = state.queue[i]
                            Text(
                                t.title,
                                modifier = Modifier.fillMaxWidth().clickable { vm.play(state.queue, i) }.padding(horizontal = 4.dp, vertical = 12.dp),
                                color = if (i == state.index) scheme.primary else scheme.onSurface,
                                fontWeight = if (i == state.index) FontWeight.SemiBold else FontWeight.Normal,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    1 -> LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                        val lines = lyrics?.lines.orEmpty()
                        if (lines.isEmpty()) {
                            item {
                                Text(
                                    "Текст пока недоступен",
                                    color = scheme.onSurfaceVariant,
                                    modifier = Modifier.padding(vertical = 24.dp).fillMaxWidth(),
                                    textAlign = TextAlign.Center,
                                )
                            }
                        }
                        items(lines) { line ->
                            val active = lyrics?.synced == true && state.positionMs >= line.timeMs
                            Text(
                                line.text,
                                color = if (active) scheme.onSurface else scheme.onSurfaceVariant,
                                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.padding(vertical = 6.dp),
                            )
                        }
                    }
                    else -> {
                        val similar by vm.tracks.collectAsState()
                        if (similar.isEmpty()) {
                            Text("Похожих треков нет", color = scheme.onSurfaceVariant, modifier = Modifier.padding(vertical = 24.dp))
                        }
                        LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                            items(similar) { t ->
                                TrackRow(
                                    t,
                                    t.id in liked,
                                    onPlay = { vm.play(similar, similar.indexOf(t)) },
                                    onLike = { vm.toggleLike(t) },
                                    onDownload = { vm.download(t) },
                                    active = state.current?.id == t.id && state.current?.source == t.source,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TrackHeading(
    title: String,
    artist: String,
    liked: Boolean,
    onLike: () -> Unit,
    onArtist: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Text(
                artist,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.clickable(onClick = onArtist),
            )
        }
        IconButton(onLike) {
            Icon(
                if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                contentDescription = if (liked) "Убрать из библиотеки" else "Добавить в библиотеку",
                tint = if (liked) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

@Composable
private fun PlayerTabs(tab: Int, onTab: (Int) -> Unit, onSimilar: () -> Unit) {
    val labels = listOf("Очередь", "Текст", "Похожие")
    Row(
        Modifier
            .padding(vertical = 12.dp)
            .clip(CircleShape)
            .background(Color.Black.copy(alpha = 0.35f))
            .padding(4.dp)
            .fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        labels.forEachIndexed { index, label ->
            val selected = tab == index
            Text(
                label,
                color = if (selected) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium,
                style = MaterialTheme.typography.labelLarge,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .weight(1f)
                    .clip(CircleShape)
                    .background(if (selected) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.16f) else Color.Transparent)
                    .clickable {
                        onTab(index)
                        if (index == 2) onSimilar()
                    }
                    .padding(vertical = 10.dp),
            )
        }
    }
}

@Composable
private fun NowPlayingControls(vm: MssViewModel, state: com.mss.core.player.PlayerUiState) {
    val scheme = MaterialTheme.colorScheme
    val duration = state.durationMs.toFloat().coerceAtLeast(1f)
    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(formatClock(state.positionMs), style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
        Text(formatClock(state.durationMs), style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
    }
    Slider(
        value = state.positionMs.toFloat().coerceIn(0f, duration),
        onValueChange = { vm.player.seekTo(it.toLong()) },
        valueRange = 0f..duration,
        modifier = Modifier.fillMaxWidth(),
        colors = SliderDefaults.colors(
            thumbColor = scheme.onSurface,
            activeTrackColor = scheme.onSurface,
            inactiveTrackColor = scheme.onSurface.copy(alpha = 0.18f),
        ),
    )
    Row(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton({ vm.player.prev() }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Default.SkipPrevious, "Предыдущий", modifier = Modifier.size(32.dp), tint = scheme.onSurface.copy(alpha = 0.9f))
        }
        IconButton({ vm.player.toggle() }, modifier = Modifier.size(72.dp)) {
            Icon(
                if (state.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                if (state.playing) "Пауза" else "Играть",
                tint = scheme.onSurface,
                modifier = Modifier.size(48.dp),
            )
        }
        IconButton({ vm.player.next() }, modifier = Modifier.size(48.dp)) {
            Icon(Icons.Default.SkipNext, "Следующий", modifier = Modifier.size(32.dp), tint = scheme.onSurface.copy(alpha = 0.9f))
        }
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
        IconButton({ vm.player.setShuffle(!state.shuffle) }) {
            Icon(
                Icons.Default.Shuffle,
                if (state.shuffle) "Не перемешивать" else "Перемешать",
                tint = if (state.shuffle) scheme.primary else scheme.onSurfaceVariant,
            )
        }
        IconButton({ vm.player.cycleRepeat() }) {
            Icon(
                if (state.repeat == RepeatMode.ONE) Icons.Default.RepeatOne else Icons.Default.Repeat,
                when (state.repeat) {
                    RepeatMode.OFF -> "Повтор выключен"
                    RepeatMode.ALL -> "Повтор списка"
                    RepeatMode.ONE -> "Повтор трека"
                },
                tint = if (state.repeat == RepeatMode.OFF) scheme.onSurfaceVariant else scheme.primary,
            )
        }
    }
}

@Composable
private fun PlayerBackdrop(coverUrl: String?) {
    Box(Modifier.fillMaxSize().background(Color(0xFF070708))) {
        if (!coverUrl.isNullOrBlank()) {
            AsyncImage(
                model = coverUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().graphicsLayer {
                    scaleX = 1.2f
                    scaleY = 1.2f
                    alpha = 0.55f
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        renderEffect = coverBlur()
                    }
                },
            )
        }
        Box(
            Modifier.fillMaxSize().background(
                Brush.verticalGradient(
                    listOf(Color.Black.copy(alpha = 0.28f), Color.Black.copy(alpha = 0.55f), Color.Black.copy(alpha = 0.82f)),
                ),
            ),
        )
    }
}

@RequiresApi(Build.VERSION_CODES.S)
private fun coverBlur() = RenderEffect.createBlurEffect(70f, 70f, Shader.TileMode.CLAMP).asComposeRenderEffect()

private fun formatClock(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(total / 60, total % 60)
}

@Composable
private fun SessionVisualizer(sessionId: Int) {
    var level by remember { mutableFloatStateOf(0f) }
    DisposableEffect(sessionId) {
        val main = Handler(Looper.getMainLooper())
        val vis = runCatching {
            Visualizer(sessionId).apply {
                captureSize = Visualizer.getCaptureSizeRange()[0]
                setDataCaptureListener(
                    object : Visualizer.OnDataCaptureListener {
                        override fun onWaveFormDataCapture(visualizer: Visualizer?, waveform: ByteArray?, samplingRate: Int) {
                            if (waveform == null) return
                            val avg = waveform.map { kotlin.math.abs(it.toInt()) }.average()
                            val next = (avg / 128.0).toFloat().coerceIn(0f, 1f)
                            main.post { level = next }
                        }
                        override fun onFftDataCapture(visualizer: Visualizer?, fft: ByteArray?, samplingRate: Int) = Unit
                    },
                    Visualizer.getMaxCaptureRate() / 2,
                    true,
                    false,
                )
                enabled = true
            }
        }.getOrNull()
        onDispose {
            vis?.release()
            main.removeCallbacksAndMessages(null)
        }
    }
    LinearProgressIndicator({ level }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
}
