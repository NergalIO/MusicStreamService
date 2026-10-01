package com.mss.android.ui.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.Alignment
import androidx.activity.compose.BackHandler
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedTrack

fun sourceLabel(source: SourceId): String = when (source) {
    SourceId.LOCAL -> "MSS"
    SourceId.SPOTIFY -> "Spotify"
    SourceId.YANDEX -> "Yandex"
    SourceId.VK -> "VK"
}

@Composable
fun SourceTag(source: SourceId, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    val local = source == SourceId.LOCAL
    Text(
        sourceLabel(source),
        modifier = modifier
            .clip(RoundedCornerShape(4.dp))
            .background(if (local) scheme.primary.copy(alpha = 0.18f) else scheme.onSurface.copy(alpha = 0.08f))
            .padding(horizontal = 6.dp, vertical = 1.dp),
        style = MaterialTheme.typography.labelSmall,
        color = if (local) scheme.primary else scheme.onSurfaceVariant,
        fontWeight = FontWeight.Medium,
    )
}

fun coverRequest(context: android.content.Context, url: String?): ImageRequest {
    val data = com.mss.core.connectors.SpotifyImageUrls.normalize(url)
    val builder = ImageRequest.Builder(context).data(data).crossfade(120)
    if (data != null && (data.contains("scdn.co") || data.contains("spotifycdn.com") || data.contains("spotify.com"))) {
        builder
            .addHeader(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
            )
            .addHeader("Referer", "https://open.spotify.com/")
    }
    return builder.build()
}

@Composable
fun Cover(url: String?, modifier: Modifier = Modifier.size(48.dp), corner: Dp = 10.dp) {
    val scheme = MaterialTheme.colorScheme
    val failed = remember(url) { mutableStateOf(url.isNullOrBlank()) }
    Box(
        modifier.clip(RoundedCornerShape(corner)).background(scheme.onSurface.copy(alpha = 0.07f)),
        contentAlignment = Alignment.Center,
    ) {
        if (!failed.value) {
            AsyncImage(
                model = coverRequest(LocalContext.current, url),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                onError = { failed.value = true },
                modifier = Modifier.matchParentSize(),
            )
        } else {
            Icon(Icons.Default.MusicNote, contentDescription = null, tint = scheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TrackRow(
    track: UnifiedTrack,
    liked: Boolean,
    onPlay: () -> Unit,
    onLike: () -> Unit,
    onDownload: () -> Unit,
    onSimilar: (() -> Unit)? = null,
    onQueue: (() -> Unit)? = null,
    onWave: (() -> Unit)? = null,
    onSuggest: (() -> Unit)? = null,
    active: Boolean = false,
    selected: Boolean = false,
    selecting: Boolean = false,
    onToggleSelect: (() -> Unit)? = null,
    onLongClick: (() -> Unit)? = null,
) {
    val menu = remember { mutableStateOf(false) }
    val scheme = MaterialTheme.colorScheme
    fun onRowClick() {
        if (selecting) {
            onToggleSelect?.invoke()
        } else {
            onPlay()
        }
    }
    val longPress = onLongClick
    Row(
        Modifier
            .fillMaxWidth()
            .background(
                when {
                    selected -> scheme.primary.copy(alpha = 0.16f)
                    active -> scheme.onSurface.copy(alpha = 0.06f)
                    else -> scheme.background.copy(alpha = 0f)
                },
            )
            .then(
                if (longPress != null) {
                    Modifier.combinedClickable(onClick = { onRowClick() }, onLongClick = longPress)
                } else {
                    Modifier.clickable(onClick = { onRowClick() })
                },
            )
            .padding(start = 8.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(0.dp),
    ) {
        if (selecting || selected) {
            Checkbox(checked = selected, onCheckedChange = { onToggleSelect?.invoke() }, modifier = Modifier.size(40.dp))
        }
        Cover(track.coverUrl, Modifier.size(48.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    track.title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                    color = if (active) scheme.primary else scheme.onSurface,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                if (active) Icon(Icons.Default.GraphicEq, contentDescription = "Играет", tint = scheme.primary, modifier = Modifier.size(16.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    track.artist,
                    style = MaterialTheme.typography.bodySmall,
                    color = scheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f, fill = false),
                )
                SourceTag(track.source)
            }
        }
        if (!selecting) {
            IconButton(onClick = onLike, modifier = Modifier.size(40.dp)) {
                Icon(
                    if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                    contentDescription = if (liked) "Убрать из библиотеки" else "Добавить в библиотеку",
                    tint = if (liked) scheme.primary else scheme.onSurfaceVariant,
                )
            }
            DownloadButton(track)
            val host = LocalTrackHost.current
            IconButton(onClick = { menu.value = true }, modifier = Modifier.size(40.dp)) {
                Icon(Icons.Default.MoreVert, contentDescription = "Ещё", tint = scheme.onSurfaceVariant)
                if (host != null) {
                    if (menu.value) TrackActionsSheet(track, onDismiss = { menu.value = false })
                    return@IconButton
                }
                DropdownMenu(menu.value, { menu.value = false }) {
                    DropdownMenuItem(
                        text = { Text(if (liked) "Убрать лайк" else "Лайк") },
                        onClick = { menu.value = false; onLike() },
                        leadingIcon = { Icon(if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder, null) },
                    )
                    DropdownMenuItem(text = { Text("Скачать") }, onClick = { menu.value = false; onDownload() }, leadingIcon = { Icon(Icons.Default.Download, null) })
                    onQueue?.let { DropdownMenuItem(text = { Text("В очередь") }, onClick = { menu.value = false; it() }) }
                    onSimilar?.let { DropdownMenuItem(text = { Text("Похожие") }, onClick = { menu.value = false; it() }) }
                    onWave?.let { DropdownMenuItem(text = { Text("Волна по треку") }, onClick = { menu.value = false; it() }) }
                    onSuggest?.let {
                        DropdownMenuItem(
                            text = { Text("Предложить") },
                            onClick = { menu.value = false; it() },
                            leadingIcon = { Icon(Icons.Default.Send, null) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun TrackList(
    tracks: List<UnifiedTrack>,
    liked: Set<String>,
    onPlay: (List<UnifiedTrack>, Int) -> Unit,
    onLike: (UnifiedTrack) -> Unit,
    onDownload: (UnifiedTrack) -> Unit,
    onSimilar: ((UnifiedTrack) -> Unit)? = null,
    onQueue: ((UnifiedTrack) -> Unit)? = null,
    onWave: ((UnifiedTrack) -> Unit)? = null,
    onSuggest: ((UnifiedTrack) -> Unit)? = null,
    onQueueMany: ((List<UnifiedTrack>) -> Unit)? = null,
    onPublishMany: ((List<UnifiedTrack>) -> Unit)? = null,
    onDeleteMany: ((List<UnifiedTrack>) -> Unit)? = null,
    currentKey: String? = null,
    selectable: Boolean = true,
    header: LazyListScope.() -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val selected = remember { mutableStateOf(emptySet<String>()) }
    val confirmDelete = remember { mutableStateOf(false) }
    val selecting = selected.value.isNotEmpty()
    fun keyOf(i: Int, t: UnifiedTrack) = "${t.source}:${t.id}:$i"
    LaunchedEffect(tracks) {
        val alive = tracks.mapIndexed { i, t -> keyOf(i, t) }.toSet()
        selected.value = selected.value.filter { it in alive }.toSet()
    }
    fun picked() = tracks.filterIndexed { i, t -> keyOf(i, t) in selected.value }
    fun clear() {
        selected.value = emptySet()
        confirmDelete.value = false
    }
    BackHandler(enabled = selecting) { clear() }
    Box(modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = if (selecting) 88.dp else 16.dp)) {
            header()
            itemsIndexed(tracks, key = { i, t -> keyOf(i, t) }) { index, track ->
                val key = keyOf(index, track)
                TrackRow(
                    track = track,
                    liked = track.id in liked,
                    onPlay = { onPlay(tracks, index) },
                    onLike = { onLike(track) },
                    onDownload = { onDownload(track) },
                    onSimilar = onSimilar?.let { { it(track) } },
                    onQueue = onQueue?.let { { it(track) } },
                    onWave = onWave?.takeIf { track.source == SourceId.YANDEX }?.let { { it(track) } },
                    onSuggest = onSuggest?.let { { it(track) } },
                    active = currentKey == "${track.source}:${track.id}",
                    selected = key in selected.value,
                    selecting = selecting,
                    onToggleSelect = {
                        selected.value = if (key in selected.value) selected.value - key else selected.value + key
                    },
                    onLongClick = if (selectable) ({
                        selected.value = selected.value + key
                    }) else null,
                )
            }
        }
        if (selecting) {
            val items = picked()
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(12.dp),
                shape = RoundedCornerShape(28.dp),
                tonalElevation = 6.dp,
                shadowElevation = 8.dp,
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("${items.size}", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 12.dp))
                    IconButton({
                        if (onQueueMany != null) onQueueMany(items) else items.forEach { onQueue?.invoke(it) }
                        clear()
                    }) { Icon(Icons.AutoMirrored.Filled.QueueMusic, "В очередь") }
                    IconButton({
                        items.filter { it.id !in liked }.forEach(onLike)
                        clear()
                    }) { Icon(Icons.Default.Favorite, "Мне нравится") }
                    IconButton({
                        items.forEach(onDownload)
                        clear()
                    }) { Icon(Icons.Default.Download, "Скачать") }
                    if (onPublishMany != null && items.any { it.source == SourceId.LOCAL }) {
                        IconButton({
                            onPublishMany(items)
                            clear()
                        }) { Icon(Icons.Outlined.CloudUpload, "Отправить на сервер MSS") }
                    }
                    if (onDeleteMany != null) {
                        IconButton({ confirmDelete.value = true }) {
                            Icon(Icons.Default.Delete, "Удалить", tint = MaterialTheme.colorScheme.error)
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    IconButton({ clear() }) { Icon(Icons.Default.Close, "Снять выделение") }
                }
            }
        }
    }
    if (confirmDelete.value) {
        val items = picked()
        AlertDialog(
            onDismissRequest = { confirmDelete.value = false },
            title = { Text(if (items.size == 1) "Удалить трек?" else "Удалить треки?") },
            text = {
                Text(
                    if (items.size == 1) "«${items[0].title}» будет удалён с сервера MSS и из всех плейлистов."
                    else "${items.size} треков будут удалены с сервера MSS и из всех плейлистов.",
                )
            },
            confirmButton = {
                TextButton({
                    onDeleteMany?.invoke(items)
                    clear()
                }) { Text("Удалить", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton({ confirmDelete.value = false }) { Text("Отмена") } },
        )
    }
}
