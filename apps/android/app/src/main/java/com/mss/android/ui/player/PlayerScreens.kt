package com.mss.android.ui.player

import android.media.audiofx.Visualizer
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animate
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.animation.core.Animatable
import androidx.compose.ui.input.pointer.pointerInput
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
import androidx.compose.foundation.layout.requiredHeight
import androidx.compose.foundation.layout.requiredWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Send
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Velocity
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
import androidx.compose.ui.unit.lerp
import androidx.compose.ui.unit.min
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.mss.android.ui.LyricsUi
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.Cover
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.MssSlider
import com.mss.android.ui.components.coverRequest
import com.mss.android.ui.components.TrackActionsSheet
import com.mss.android.ui.components.TrackRow
import com.mss.android.ui.theme.AccentPanelBackground
import com.mss.android.ui.theme.COVER_ACCENT
import com.mss.android.ui.theme.ChipFlow
import com.mss.android.ui.theme.MssTheme
import com.mss.android.ui.theme.isolatedCoverBlur
import com.mss.android.ui.theme.rememberCoverHsl
import com.mss.core.connectors.SpotifyDevice
import com.mss.core.model.EqPresets
import com.mss.core.model.LobbyDto
import com.mss.core.model.PlaybackSettings
import kotlinx.coroutines.launch
import com.mss.core.model.SourceId
import kotlinx.coroutines.flow.first
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.WaveSettings
import com.mss.core.player.PlayerUiState
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
    if (track?.source != SourceId.SPOTIFY || remote.isNullOrBlank() || remote == "null") return
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
fun MiniPlayer(
    vm: MssViewModel,
    onOpen: () -> Unit,
    below: @Composable () -> Unit = {},
) {
    val settings by vm.playbackSettings.collectAsState()
    val state by vm.playerState.collectAsState()
    val liked by vm.likedIds.collectAsState()
    val scheme = MaterialTheme.colorScheme
    val track = state.current
    if (track == null) {
        Box(Modifier.fillMaxWidth().background(scheme.surfaceContainer)) { below() }
        return
    }
    val progress = if (state.durationMs == 0L) 0f else (state.positionMs / state.durationMs.toFloat()).coerceIn(0f, 1f)
    val isLiked = track.id in liked
    AccentPanelBackground(accent = settings.accent, coverUrl = track.coverUrl, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth()) {
            SpotifyDeviceBar(vm, track)
            Box(Modifier.fillMaxWidth().height(2.dp).background(scheme.onSurface.copy(alpha = 0.10f))) {
                Box(Modifier.fillMaxHeight().fillMaxWidth(progress).background(scheme.primary))
            }
            val scope = rememberCoroutineScope()
            val dragX = remember { Animatable(0f) }
            val swipeThreshold = with(LocalDensity.current) { 72.dp.toPx() }
            Row(
                Modifier
                    .fillMaxWidth()
                    .height(64.dp)
                    .clickable(onClick = onOpen)
                    .pointerInput(Unit) {
                        detectHorizontalDragGestures(
                            onDragEnd = {
                                val x = dragX.value
                                when {
                                    x <= -swipeThreshold -> vm.player.next()
                                    x >= swipeThreshold -> vm.player.skipPrevious()
                                }
                                scope.launch { dragX.animateTo(0f) }
                            },
                            onDragCancel = { scope.launch { dragX.animateTo(0f) } },
                        ) { change, amount ->
                            change.consume()
                            scope.launch { dragX.snapTo(dragX.value + amount) }
                        }
                    }
                    .padding(horizontal = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(
                    Modifier
                        .weight(1f)
                        .graphicsLayer {
                            translationX = dragX.value
                            alpha = 1f - (kotlin.math.abs(dragX.value) / (swipeThreshold * 3)).coerceIn(0f, 0.6f)
                        },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Cover(track.coverUrl, Modifier.size(44.dp))
                    Column(Modifier.weight(1f).padding(start = 8.dp)) {
                        Text(track.title, maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            track.artist,
                            style = MaterialTheme.typography.bodySmall,
                            color = scheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                IconButton({ vm.toggleLike(track) }) {
                    Icon(
                        if (isLiked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                        contentDescription = if (isLiked) "Убрать из библиотеки" else "Добавить в библиотеку",
                        tint = if (isLiked) scheme.primary else scheme.onSurface.copy(alpha = 0.85f),
                    )
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
            }
            below()
        }
    }
}

@Composable
private fun TrackMenuButton(track: UnifiedTrack) {
    var open by remember { mutableStateOf(false) }
    IconButton({ open = true }) {
        Icon(Icons.Default.MoreVert, "Ещё", tint = MaterialTheme.colorScheme.onSurface)
    }
    if (open) TrackActionsSheet(track, onDismiss = { open = false })
}

@Composable
fun NowPlayingScreen(
    vm: MssViewModel,
    onBack: () -> Unit = {},
    onArtist: (UnifiedTrack) -> Unit = {},
    onAlbum: (UnifiedTrack) -> Unit = {},
) {
    val settings by vm.playbackSettings.collectAsState()
    val state by vm.playerState.collectAsState()
    val cover = if (settings.accent == COVER_ACCENT) rememberCoverHsl(state.current?.coverUrl) else null
    MssTheme(accent = settings.accent, dark = true, cover = cover) {
        NowPlayingBody(vm, onBack, onArtist, onAlbum)
    }
}

@Composable
private fun NowPlayingBody(
    vm: MssViewModel,
    onBack: () -> Unit,
    onArtist: (UnifiedTrack) -> Unit,
    onAlbum: (UnifiedTrack) -> Unit,
) {
    val state by vm.playerState.collectAsState()
    val lyrics by vm.lyrics.collectAsState()
    val liked by vm.likedIds.collectAsState()
    val settings by vm.playbackSettings.collectAsState()
    val similar by vm.similar.collectAsState()
    val canSuggest by vm.canSuggestToLobby.collectAsState()
    val track = state.current
    var dragY by remember { mutableFloatStateOf(0f) }
    val dismissThreshold = with(LocalDensity.current) { 120.dp.toPx() }
    val currentOnBack by rememberUpdatedState(onBack)
    val dismissScroll = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (available.y >= 0f || dragY <= 0f) return Offset.Zero
                val used = maxOf(available.y, -dragY)
                dragY += used
                return Offset(0f, used)
            }

            override fun onPostScroll(consumed: Offset, available: Offset, source: NestedScrollSource): Offset {
                if (source != NestedScrollSource.UserInput || available.y <= 0f) return Offset.Zero
                dragY += available.y
                return Offset(0f, available.y)
            }

            override suspend fun onPreFling(available: Velocity): Velocity {
                if (dragY <= 0f) return Velocity.Zero
                if (dragY > dismissThreshold || available.y > 1800f) {
                    currentOnBack()
                } else {
                    animate(dragY, 0f) { value, _ -> dragY = value }
                }
                return available
            }
        }
    }
    Box(
        Modifier
            .fillMaxSize()
            .nestedScroll(dismissScroll)
            .graphicsLayer { translationY = dragY },
    ) {
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
            val showVisualizer = settings.visualizer && !landscape
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 32.dp),
            ) {
                item {
                    IconButton(onBack) {
                        Icon(Icons.Default.KeyboardArrowDown, "Свернуть", tint = scheme.onSurface)
                    }
                }
                item {
                    CoverStage(track.coverUrl, tab, Modifier.fillMaxWidth().height(cover)) { shown ->
                        when (shown) {
                            0 -> LazyColumn(
                                state = rememberLazyListState(initialFirstVisibleItemIndex = state.index.coerceAtLeast(0)),
                                modifier = Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(8.dp),
                            ) { queueRows(state, liked, vm, canSuggest) }
                            1 -> LyricsPane(vm, lyrics, state.positionMs, Modifier.fillMaxSize())
                            2 -> LazyColumn(
                                modifier = Modifier.fillMaxSize(),
                                contentPadding = PaddingValues(8.dp),
                            ) { similarRows(similar, liked, state, vm, canSuggest) }
                        }
                    }
                }
                item {
                    TrackHeading(
                        track.title,
                        track.artist,
                        track.id in liked,
                        { vm.toggleLike(track) },
                        { onArtist(track) },
                        Modifier.padding(top = 16.dp),
                        menu = { TrackMenuButton(track) },
                    )
                }
                if (showVisualizer) {
                    item { SessionVisualizer(vm.player.audioSessionId()) }
                }
                item { NowPlayingControls(vm, state) }
                item {
                    SourceAction(track) {
                        when (track.source) {
                            SourceId.YANDEX -> vm.startWave(WaveSettings(seed = "track:${track.id}", seedTitle = track.title))
                            SourceId.SPOTIFY -> vm.startSpotifyRadio(track)
                            else -> {}
                        }
                    }
                }
                item {
                    PlayerTabs(tab) { index ->
                        tab = if (tab == index) null else index
                    }
                }
                item {
                    val artistKey = "${track.source}:${track.artists?.firstOrNull()?.id ?: track.artist}"
                    val artistImage by produceState<String?>(null, artistKey) { value = vm.artistImage(track) }
                    NowPlayingEntityCard(
                        caption = "Исполнитель",
                        title = track.artist,
                        subtitle = track.album?.takeIf { it.isNotBlank() },
                        coverUrl = artistImage,
                        round = true,
                        onClick = { onArtist(track) },
                    )
                }
                if (!track.album.isNullOrBlank() || !track.albumId.isNullOrBlank()) {
                    item {
                        NowPlayingEntityCard(
                            caption = "Альбом",
                            title = track.album?.ifBlank { null } ?: "Альбом",
                            subtitle = track.artist,
                            coverUrl = track.coverUrl,
                            onClick = { onAlbum(track) },
                        )
                    }
                }
                item { PlaybackSettingsCard(vm, settings, state) }
            }
        }
    }
}

/** Обложка; при открытой вкладке она размывается и поверх показывается содержимое вкладки. */
@Composable
private fun CoverStage(coverUrl: String?, tab: Int?, modifier: Modifier, content: @Composable (Int) -> Unit) {
    val dim by animateFloatAsState(if (tab != null) 1f else 0f, tween(320), label = "coverDim")
    val hsl = rememberCoverHsl(coverUrl)
    val tint = if (hsl != null) Color.hsl(hsl.first, (hsl.second * 0.6f).coerceAtMost(0.5f), 0.12f) else Color.Black
    Box(modifier.clip(RoundedCornerShape(16.dp))) {
        Cover(
            coverUrl,
            Modifier
                .matchParentSize()
                .then(if (dim > 0f) Modifier.blur((28 * dim).dp) else Modifier),
            corner = 16.dp,
        )
        if (dim > 0f) Box(Modifier.matchParentSize().background(tint.copy(alpha = 0.55f * dim)))
        Crossfade(tab, animationSpec = tween(320), label = "coverStage") { shown ->
            if (shown != null) Box(Modifier.fillMaxSize()) { content(shown) }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.queueRows(
    state: PlayerUiState,
    liked: Set<String>,
    vm: MssViewModel,
    canSuggest: Boolean,
) {
    val queue = state.queue
    if (queue.isEmpty()) {
        item {
            Text(
                "Очередь пуста",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(24.dp),
                textAlign = TextAlign.Center,
            )
        }
        return
    }
    itemsIndexed(queue, key = { i, t -> "q:${t.source}:${t.id}:$i" }) { i, t ->
        TrackRow(
            t,
            t.id in liked,
            onPlay = { vm.play(queue, i) },
            onLike = { vm.toggleLike(t) },
            onDownload = { vm.download(t) },
            onSuggest = if (canSuggest) ({ vm.suggestToLobby(t) }) else null,
            active = i == state.index,
        )
    }
}

private fun androidx.compose.foundation.lazy.LazyListScope.similarRows(
    similar: List<UnifiedTrack>,
    liked: Set<String>,
    state: PlayerUiState,
    vm: MssViewModel,
    canSuggest: Boolean,
) {
    if (similar.isEmpty()) {
        item {
            Text(
                "Похожих треков нет",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth().padding(24.dp),
                textAlign = TextAlign.Center,
            )
        }
        return
    }
    itemsIndexed(similar, key = { i, t -> "s:${t.source}:${t.id}:$i" }) { i, t ->
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
        snapshotFlow { listState.layoutInfo.viewportEndOffset - listState.layoutInfo.viewportStartOffset }.first { it > 0 }
        if (SystemClock.elapsedRealtime() < holdUntil) return@LaunchedEffect
        listState.centerLyric(active)
    }
    BoxWithConstraints(modifier) {
        LazyColumn(
            state = listState,
            modifier = Modifier.fillMaxSize().nestedScroll(userScroll).padding(horizontal = 8.dp),
            contentPadding = PaddingValues(vertical = maxHeight / 2),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            itemsIndexed(lines) { i, line ->
                val current = data.synced && i == active
                val label = line.text.trim().ifEmpty { if (data.synced) "♪" else "" }
                if (label.isEmpty()) return@itemsIndexed
                LyricLine(
                    label,
                    active = current,
                    synced = data.synced,
                    onClick = if (data.synced && line.timeMs >= 0) ({ vm.player.seekTo(line.timeMs) }) else null,
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

private val LyricMove = tween<Float>(durationMillis = 480, easing = FastOutSlowInEasing)

/** Ставит строку в центр панели одним плавным сдвигом. */
private suspend fun androidx.compose.foundation.lazy.LazyListState.centerLyric(index: Int) {
    if (layoutInfo.viewportSize.height <= 0) return
    // Смещения элементов отсчитываются от края верхнего contentPadding, а не от верха viewport.
    val center = (layoutInfo.viewportStartOffset + layoutInfo.viewportEndOffset) / 2
    if (layoutInfo.visibleItemsInfo.none { it.index == index }) {
        val guess = layoutInfo.visibleItemsInfo.firstOrNull()?.size ?: 72
        animateScrollToItem(index, scrollOffset = guess / 2 - center)
    }
    val item = layoutInfo.visibleItemsInfo.find { it.index == index } ?: return
    val delta = item.offset + item.size / 2 - center
    if (kotlin.math.abs(delta) > 2) animateScrollBy(delta.toFloat(), LyricMove)
}

@Composable
private fun LyricLine(text: String, active: Boolean, synced: Boolean, onClick: (() -> Unit)?) {
    val emphasis by animateFloatAsState(if (active) 1f else 0f, LyricMove, label = "lyric")
    val scheme = MaterialTheme.colorScheme
    val color = if (!synced) {
        scheme.onSurface.copy(alpha = 0.85f)
    } else {
        lerp(scheme.onSurface.copy(alpha = 0.32f), scheme.onSurface, emphasis)
    }
    // Размер шрифта не анимируем: высота строки должна быть постоянной, иначе центрирование уезжает.
    Text(
        text,
        color = color,
        fontWeight = FontWeight.Bold,
        fontSize = if (synced) 25.sp else 18.sp,
        lineHeight = if (synced) 31.sp else 24.sp,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                val scale = if (synced) 0.8f + 0.2f * emphasis else 1f
                scaleX = scale
                scaleY = scale
            }
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(vertical = 8.dp),
    )
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
private fun NowPlayingEntityCard(
    caption: String,
    title: String,
    subtitle: String?,
    coverUrl: String?,
    round: Boolean = false,
    onClick: (() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    Row(
        Modifier
            .padding(top = 12.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(scheme.onSurface.copy(alpha = 0.10f))
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Cover(coverUrl, Modifier.size(72.dp), corner = if (round) 36.dp else 12.dp)
        Column(Modifier.weight(1f)) {
            Text(caption, style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant)
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (!subtitle.isNullOrBlank()) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        if (onClick != null) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = null, tint = scheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun PlaybackSettingsCard(vm: MssViewModel, settings: PlaybackSettings, state: PlayerUiState) {
    val scheme = MaterialTheme.colorScheme
    val seconds = settings.crossfadeMs / 1000
    Column(
        Modifier
            .padding(top = 12.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(scheme.onSurface.copy(alpha = 0.10f))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Настройки воспроизведения", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text("Таймер сна", style = MaterialTheme.typography.labelLarge)
        ChipFlow {
            MssChip(!state.sleepUntilTrackEnd && state.sleepEndsAt == null, "Выкл") { vm.player.setSleepTimer(null) }
            MssChip(state.sleepEndsAt != null, "30 мин") { vm.player.setSleepTimer(30) }
            MssChip(state.sleepUntilTrackEnd, "До конца трека") { vm.player.setSleepUntilEnd() }
        }
        Text("Затухание", style = MaterialTheme.typography.labelLarge)
        Text(
            if (seconds == 0) "Выключено" else "$seconds с между треками",
            style = MaterialTheme.typography.bodySmall,
            color = scheme.onSurfaceVariant,
        )
        MssSlider(
            value = seconds.toFloat(),
            onValueChange = { vm.savePlayback(settings.copy(crossfadeMs = it.toInt() * 1000)) },
            valueRange = 0f..12f,
            steps = 11,
        )
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Эквалайзер", style = MaterialTheme.typography.labelLarge)
            Switch(settings.eqEnabled, { vm.savePlayback(settings.copy(eqEnabled = it)) })
        }
        val bands = EqPresets.padded(settings.eqBands)
        val activePreset = EqPresets.matching(bands)
        ChipFlow {
            EqPresets.all.forEach { preset ->
                MssChip(activePreset?.id == preset.id, preset.label) {
                    vm.savePlayback(settings.copy(eqEnabled = true, eqBands = preset.bands))
                }
            }
        }
        Row(
            Modifier
                .fillMaxWidth()
                .alpha(if (settings.eqEnabled) 1f else 0.4f)
                .padding(top = 4.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            EqPresets.frequencies.forEachIndexed { i, label ->
                VerticalEqBand(
                    label = label,
                    value = bands[i],
                    onChange = { next ->
                        val copy = bands.toMutableList()
                        copy[i] = next
                        vm.savePlayback(settings.copy(eqEnabled = true, eqBands = copy))
                    },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun VerticalEqBand(
    label: String,
    value: Float,
    onChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val track = 156.dp
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            "${if (value > 0.5f) "+" else ""}${value.toInt()}",
            style = MaterialTheme.typography.labelSmall,
            color = scheme.onSurfaceVariant,
            maxLines = 1,
        )
        Box(
            Modifier
                .height(track)
                .width(36.dp)
                .wrapContentSize(align = Alignment.Center, unbounded = true),
            contentAlignment = Alignment.Center,
        ) {
            MssSlider(
                value = value,
                onValueChange = onChange,
                valueRange = -12f..12f,
                steps = 23,
                modifier = Modifier.requiredWidth(track).requiredHeight(36.dp).rotate(-90f),
            )
        }
        Text(label, style = MaterialTheme.typography.labelSmall, color = scheme.onSurfaceVariant, maxLines = 1)
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
    menu: @Composable () -> Unit = {},
) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
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
        menu()
    }
}

@Composable
private fun PlayerTabs(tab: Int?, onTab: (Int) -> Unit) {
    val labels = listOf("Очередь", "Текст", "Похожие")
    Row(
        Modifier
            .padding(top = 12.dp, bottom = 8.dp)
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
private fun NowPlayingControls(vm: MssViewModel, state: PlayerUiState) {
    val scheme = MaterialTheme.colorScheme
    SpotifyDeviceBar(vm, state.current)
    val duration = state.durationMs.toFloat().coerceAtLeast(1f)
    Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(formatClock(state.positionMs), style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
        Text(formatClock(state.durationMs), style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant)
    }
    MssSlider(
        value = state.positionMs.toFloat().coerceIn(0f, duration),
        onValueChange = { vm.player.seekTo(it.toLong()) },
        valueRange = 0f..duration,
        modifier = Modifier.fillMaxWidth(),
    )
    Row(
        Modifier.fillMaxWidth().padding(top = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton({ vm.player.setShuffle(!state.shuffle) }, modifier = Modifier.size(44.dp)) {
            Icon(
                Icons.Default.Shuffle,
                if (state.shuffle) "Не перемешивать" else "Перемешать",
                tint = if (state.shuffle) scheme.primary else scheme.onSurfaceVariant,
            )
        }
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
        IconButton({ vm.player.cycleRepeat() }, modifier = Modifier.size(44.dp)) {
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
                model = coverRequest(LocalContext.current, coverUrl),
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
