package com.mss.android.ui.player

import android.media.audiofx.Visualizer
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
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
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Repeat
import androidx.compose.material.icons.filled.RepeatOne
import androidx.compose.material.icons.filled.Shuffle
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.zIndex
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.mss.android.ui.LyricsUi
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.Cover
import com.mss.android.ui.components.TrackRow
import com.mss.android.ui.theme.AccentPanelBackground
import com.mss.android.ui.theme.COVER_ACCENT
import com.mss.android.ui.theme.MssTheme
import com.mss.android.ui.theme.isolatedCoverBlur
import com.mss.android.ui.theme.rememberCoverHsl
import com.mss.core.connectors.SpotifyDevice
import com.mss.core.model.LobbyDto
import kotlinx.coroutines.launch
import com.mss.core.model.SourceId
import kotlinx.coroutines.flow.first
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.WaveSettings
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
private fun SpotifyDeviceBar(vm: MssViewModel, track: UnifiedTrack?) {
    val remote by vm.spotifyWeb.remoteDevice.collectAsState()
    if (track?.source != SourceId.SPOTIFY || remote.isNullOrBlank()) return
    var open by remember { mutableStateOf(false) }
    val scheme = MaterialTheme.colorScheme
    Text(
        "Воспроизведение на «$remote» — выбрать устройство",
        color = scheme.primary,
        style = MaterialTheme.typography.labelLarge,
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(scheme.primary.copy(alpha = 0.14f))
            .clickable { open = true }
            .padding(horizontal = 12.dp, vertical = 8.dp),
    )
    if (open) SpotifyDeviceDialog(vm, onClose = { open = false })
}

@Composable
private fun SpotifyDeviceDialog(vm: MssViewModel, onClose: () -> Unit) {
    val scope = rememberCoroutineScope()
    var devices by remember { mutableStateOf<List<SpotifyDevice>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var pending by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        val result = runCatching { vm.spotifyWeb.listDevices() }
        loading = false
        result.onSuccess { devices = it }
        result.onFailure { error = it.message ?: "Не удалось получить устройства Spotify" }
        if (result.getOrNull().isNullOrEmpty() && error == null) {
            error = "Spotify не показал устройства. Закройте окно и откройте его снова."
        }
    }
    AlertDialog(
        onDismissRequest = { if (!pending) onClose() },
        title = { Text("Устройство воспроизведения") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "Spotify играет только на одном устройстве. Выберите, где должен звучать трек.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (loading) {
                    CircularProgressIndicator(Modifier.padding(top = 12.dp).size(24.dp), strokeWidth = 2.dp)
                }
                error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 8.dp))
                }
                devices.forEach { device ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable(enabled = !pending) {
                                pending = true
                                scope.launch {
                                    val picked = runCatching { vm.spotifyWeb.selectDevice(device.name) }
                                    picked.onSuccess { selectedHere ->
                                        if (selectedHere || device.local) vm.player.replaySpotifyHere()
                                        onClose()
                                    }
                                    picked.onFailure {
                                        error = it.message
                                        pending = false
                                    }
                                }
                            }
                            .padding(vertical = 10.dp, horizontal = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(device.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (device.local) {
                                Text("это приложение", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        if (device.active) {
                            Text("сейчас", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onClose, enabled = !pending) { Text("Закрыть") }
        },
    )
}

@Composable
fun MiniPlayer(vm: MssViewModel, onOpen: () -> Unit) {
    val settings by vm.playbackSettings.collectAsState()
    val state by vm.playerState.collectAsState()
    val track = state.current ?: return
    val scheme = MaterialTheme.colorScheme
    val progress = if (state.durationMs == 0L) 0f else (state.positionMs / state.durationMs.toFloat()).coerceIn(0f, 1f)
    AccentPanelBackground(accent = settings.accent, coverUrl = track.coverUrl, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth()) {
            SpotifyDeviceBar(vm, track)
            Box(Modifier.fillMaxWidth().height(2.dp).background(scheme.onSurface.copy(alpha = 0.10f))) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(progress).background(scheme.primary))
            }
            Row(
                Modifier.fillMaxWidth().height(64.dp).clickable(onClick = onOpen).padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Cover(track.coverUrl, Modifier.size(44.dp))
                Column(Modifier.weight(1f)) {
                    Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                    Text(
                        track.artist,
                        style = MaterialTheme.typography.bodySmall,
                        color = scheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
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
                        Modifier.size(36.dp).clip(CircleShape).background(scheme.primary),
                        contentAlignment = Alignment.Center,
                    ) {
                        Icon(
                            if (state.playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = null,
                            tint = scheme.onPrimary,
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
}

@Composable
fun NowPlayingScreen(vm: MssViewModel, onBack: () -> Unit = {}, onArtist: (String) -> Unit = {}) {
    val settings by vm.playbackSettings.collectAsState()
    val state by vm.playerState.collectAsState()
    val cover = if (settings.accent == COVER_ACCENT) rememberCoverHsl(state.current?.coverUrl) else null
    MssTheme(accent = settings.accent, dark = true, cover = cover) {
        NowPlayingBody(vm, onBack, onArtist)
    }
}

@Composable
private fun NowPlayingBody(vm: MssViewModel, onBack: () -> Unit, onArtist: (String) -> Unit) {
    val state by vm.playerState.collectAsState()
    val lyrics by vm.lyrics.collectAsState()
    val liked by vm.likedIds.collectAsState()
    val settings by vm.playbackSettings.collectAsState()
    val similar by vm.similar.collectAsState()
    val track = state.current
    Box(Modifier.fillMaxSize()) {
        PlayerBackdrop(track?.coverUrl)
        if (track == null) {
            Column(
                Modifier.fillMaxSize().zIndex(1f).padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
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
        var tab by remember { mutableStateOf<Int?>(null) }
        LaunchedEffect(track.source, track.id) {
            vm.loadLyrics(track)
            tab = null
        }
        LaunchedEffect(tab, track.id) {
            if (tab == 2) vm.loadSimilar(track)
        }
        val scheme = MaterialTheme.colorScheme
        BoxWithConstraints(Modifier.fillMaxSize().zIndex(1f)) {
            val landscape = maxWidth > maxHeight
            val cover = min(min(maxWidth - 48.dp, 320.dp), if (landscape) maxHeight * 0.48f else maxHeight * 0.38f)
            val showVisualizer = settings.visualizer && !landscape && maxHeight > 640.dp && tab == null
            Column(Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 8.dp)) {
                IconButton(onBack) {
                    Icon(Icons.Default.KeyboardArrowDown, "Свернуть", tint = scheme.onSurface)
                }
                PlayerTabs(tab) { index ->
                    tab = if (tab == index) null else index
                }
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(cover)
                        .clip(RoundedCornerShape(16.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    CoverSlot(track.coverUrl, blurred = tab != null, modifier = Modifier.fillMaxSize().zIndex(0f))
                    when (tab) {
                        0 -> QueuePane(state.queue, state.index, { vm.play(state.queue, it) }, Modifier.fillMaxSize().zIndex(1f))
                        1 -> LyricsPane(vm, lyrics, state.positionMs, Modifier.fillMaxSize().zIndex(1f))
                        2 -> SimilarPane(similar, liked, state, vm, Modifier.fillMaxSize().zIndex(1f))
                        else -> Cover(track.coverUrl, Modifier.fillMaxSize().zIndex(1f), corner = 16.dp)
                    }
                }
                TrackHeading(
                    track.title,
                    track.artist,
                    track.id in liked,
                    { vm.toggleLike(track) },
                    { onArtist(track.artist) },
                    Modifier.padding(top = 16.dp),
                )
                if (showVisualizer) SessionVisualizer(vm.player.audioSessionId())
                NowPlayingControls(vm, state)
                Spacer(Modifier.weight(1f))
                SourceAction(track) {
                    when (track.source) {
                        SourceId.YANDEX -> vm.startWave(WaveSettings(seed = "track:${track.id}", seedTitle = track.title))
                        SourceId.SPOTIFY -> vm.startSpotifyRadio(track)
                        else -> {}
                    }
                }
            }
        }
    }
}

@Composable
private fun CoverSlot(coverUrl: String?, blurred: Boolean, modifier: Modifier = Modifier) {
    if (coverUrl.isNullOrBlank()) {
        Box(modifier.background(Color.Black.copy(alpha = 0.35f)))
        return
    }
    AsyncImage(
        model = coverUrl,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier.isolatedCoverBlur(radiusPx = 70f, alpha = if (blurred) 0.45f else 1f, enabled = blurred),
    )
}

@Composable
private fun QueuePane(queue: List<UnifiedTrack>, index: Int, onPlay: (Int) -> Unit, modifier: Modifier) {
    val scheme = MaterialTheme.colorScheme
    LazyColumn(modifier.padding(horizontal = 8.dp, vertical = 8.dp)) {
        itemsIndexed(queue) { i, t ->
            Text(
                t.title,
                modifier = Modifier.fillMaxWidth().clickable { onPlay(i) }.padding(horizontal = 8.dp, vertical = 10.dp),
                color = if (i == index) scheme.primary else scheme.onSurface,
                fontWeight = if (i == index) FontWeight.SemiBold else FontWeight.Normal,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

private const val LYRICS_LEAD_MS = 250L

@Composable
private fun LyricsPane(vm: MssViewModel, lyrics: LyricsUi, positionMs: Long, modifier: Modifier) {
    val scheme = MaterialTheme.colorScheme
    val message = lyricsMessage(lyrics)
    if (lyrics.loading || message != null) {
        Box(modifier, contentAlignment = Alignment.Center) {
            if (lyrics.loading) {
                CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp, color = scheme.onSurface)
            } else {
                Text(
                    message.orEmpty(),
                    color = scheme.onSurface.copy(alpha = 0.55f),
                    modifier = Modifier.padding(horizontal = 20.dp),
                    textAlign = TextAlign.Center,
                )
            }
        }
        return
    }
    val data = lyrics.data ?: return
    val lines = data.lines
    val active = if (data.synced) lines.indexOfLast { positionMs + LYRICS_LEAD_MS >= it.timeMs } else -1
    val listState = rememberLazyListState()
    var holdUntil by remember { mutableLongStateOf(0L) }
    val userScroll = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput) holdUntil = SystemClock.elapsedRealtime() + 4_000
                return Offset.Zero
            }
        }
    }
    LaunchedEffect(active) {
        if (active < 0) return@LaunchedEffect
        val viewport = snapshotFlow { listState.layoutInfo.viewportSize.height }.first { it > 0 }
        if (SystemClock.elapsedRealtime() < holdUntil) return@LaunchedEffect
        val itemSize = listState.layoutInfo.visibleItemsInfo.firstOrNull()?.size ?: 0
        listState.animateScrollToItem(active, -(viewport / 2 - itemSize / 2))
    }
    BoxWithConstraints(modifier) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().nestedScroll(userScroll).padding(horizontal = 8.dp),
            contentPadding = PaddingValues(vertical = maxHeight * 0.32f),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            itemsIndexed(lines) { i, line ->
                val current = i == active
                val label = line.text.trim().ifEmpty { if (data.synced) "♪" else "" }
                if (label.isEmpty()) return@itemsIndexed
                Text(
                    label,
                    color = if (!data.synced) scheme.onSurface.copy(alpha = 0.85f)
                    else if (current) scheme.onSurface
                    else scheme.onSurface.copy(alpha = 0.35f),
                    fontWeight = FontWeight.Bold,
                    fontSize = if (data.synced && current) 26.sp else if (data.synced) 22.sp else 18.sp,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .then(
                            if (data.synced && line.timeMs >= 0) {
                                Modifier.clickable { vm.player.seekTo(line.timeMs) }
                            } else {
                                Modifier
                            },
                        )
                        .padding(vertical = if (line.text.isBlank()) 10.dp else 8.dp),
                )
            }
            data.writers?.takeIf { it.isNotEmpty() }?.let { writers ->
                item {
                    Text(
                        "Авторы: ${writers.joinToString(", ")}",
                        color = scheme.onSurface.copy(alpha = 0.4f),
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(top = 28.dp),
                    )
                }
            }
        }
    }
}

private fun lyricsMessage(lyrics: LyricsUi): String? {
    val source = lyrics.source
    if (source != SourceId.YANDEX && source != SourceId.SPOTIFY && source != SourceId.LOCAL) {
        return "Тексты песен недоступны для этого источника"
    }
    if (lyrics.loading) return null
    if (lyrics.failed) {
        return if (source == SourceId.SPOTIFY) {
            "Не удалось загрузить текст. Подождите пару секунд и откройте «Текст» снова."
        } else {
            "Не удалось загрузить текст"
        }
    }
    if (lyrics.data?.lines?.any { it.text.isNotBlank() } == true) return null
    return when (source) {
        SourceId.LOCAL -> "Нет текста. Положите .lrc или .txt рядом с файлом трека."
        SourceId.SPOTIFY -> "У этого трека нет текста в Spotify."
        else -> "У этого трека нет текста"
    }
}

@Composable
private fun SimilarPane(
    similar: List<UnifiedTrack>,
    liked: Set<String>,
    state: com.mss.core.player.PlayerUiState,
    vm: MssViewModel,
    modifier: Modifier,
) {
    val canSuggest by vm.canSuggestToLobby.collectAsState()
    if (similar.isEmpty()) {
        Text(
            "Похожих треков нет",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = modifier.padding(24.dp),
            textAlign = TextAlign.Center,
        )
        return
    }
    LazyColumn(modifier) {
        itemsIndexed(similar) { i, t ->
            TrackRow(
                t,
                t.id in liked,
                onPlay = { vm.play(similar, i) },
                onLike = { vm.toggleLike(t) },
                onDownload = { vm.download(t) },
                onSuggest = if (canSuggest) ({ vm.suggestToLobby(t) }) else null,
                active = state.current?.id == t.id && state.current?.source == t.source,
            )
        }
    }
}

@Composable
private fun SourceAction(track: UnifiedTrack, onClick: () -> Unit) {
    val label = when (track.source) {
        SourceId.YANDEX -> "Моя волна по треку"
        SourceId.SPOTIFY -> "Радио по треку"
        else -> return
    }
    val scheme = MaterialTheme.colorScheme
    Row(
        Modifier
            .padding(top = 12.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(scheme.onSurface.copy(alpha = 0.10f))
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Default.Radio, contentDescription = null, tint = scheme.onSurface)
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
            Text(track.title, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.Default.PlayArrow, contentDescription = label, tint = scheme.onSurface)
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
private fun PlayerTabs(tab: Int?, onTab: (Int) -> Unit) {
    val labels = listOf("Очередь", "Текст", "Похожие")
    Row(
        Modifier
            .padding(bottom = 12.dp)
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
                    .clickable { onTab(index) }
                    .padding(vertical = 10.dp),
            )
        }
    }
}

@Composable
private fun NowPlayingControls(vm: MssViewModel, state: com.mss.core.player.PlayerUiState) {
    val scheme = MaterialTheme.colorScheme
    SpotifyDeviceBar(vm, state.current)
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
    Box(Modifier.fillMaxSize().clipToBounds().background(Color(0xFF070708))) {
        if (!coverUrl.isNullOrBlank()) {
            AsyncImage(
                model = coverUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize().isolatedCoverBlur(radiusPx = 70f, scale = 1.2f, alpha = 0.55f),
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
