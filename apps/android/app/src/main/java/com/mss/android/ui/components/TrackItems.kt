package com.mss.android.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.Box
import androidx.compose.ui.Alignment
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
    var failed by remember(url) { mutableStateOf(url.isNullOrBlank()) }
    Box(
        modifier.clip(RoundedCornerShape(corner)).background(scheme.onSurface.copy(alpha = 0.07f)),
        contentAlignment = Alignment.Center,
    ) {
        if (!failed) {
            AsyncImage(
                model = coverRequest(LocalContext.current, url),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                onError = { failed = true },
                modifier = Modifier.matchParentSize(),
            )
        } else {
            Icon(Icons.Default.MusicNote, contentDescription = null, tint = scheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        }
    }
}

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
) {
    var menu by remember { mutableStateOf(false) }
    val scheme = MaterialTheme.colorScheme
    Row(
        Modifier
            .fillMaxWidth()
            .background(if (active) scheme.onSurface.copy(alpha = 0.06f) else scheme.background.copy(alpha = 0f))
            .clickable(onClick = onPlay)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Cover(track.coverUrl, Modifier.size(48.dp))
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
        IconButton(onClick = onLike) {
            Icon(
                if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                contentDescription = if (liked) "Убрать из библиотеки" else "Добавить в библиотеку",
                tint = if (liked) scheme.primary else scheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = { menu = true }) {
            Icon(Icons.Default.MoreVert, contentDescription = "Ещё", tint = scheme.onSurfaceVariant)
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(
                    text = { Text(if (liked) "Убрать лайк" else "Лайк") },
                    onClick = { menu = false; onLike() },
                    leadingIcon = { Icon(if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder, null) },
                )
                DropdownMenuItem(text = { Text("Скачать") }, onClick = { menu = false; onDownload() }, leadingIcon = { Icon(Icons.Default.Download, null) })
                onQueue?.let { DropdownMenuItem(text = { Text("В очередь") }, onClick = { menu = false; it() }) }
                onSimilar?.let { DropdownMenuItem(text = { Text("Похожие") }, onClick = { menu = false; it() }) }
                onWave?.let { DropdownMenuItem(text = { Text("Волна по треку") }, onClick = { menu = false; it() }) }
                onSuggest?.let {
                    DropdownMenuItem(
                        text = { Text("Предложить") },
                        onClick = { menu = false; it() },
                        leadingIcon = { Icon(Icons.Default.Send, null) },
                    )
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
    currentKey: String? = null,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier.fillMaxSize()) {
        itemsIndexed(tracks, key = { i, t -> "${t.source}:${t.id}:$i" }) { index, track ->
            TrackRow(
                track = track,
                liked = track.id in liked,
                onPlay = { onPlay(tracks, index) },
                onLike = { onLike(track) },
                onDownload = { onDownload(track) },
                onSimilar = onSimilar?.let { { it(track) } },
                onQueue = onQueue?.let { { it(track) } },
                onWave = onWave?.let { { it(track) } },
                onSuggest = onSuggest?.let { { it(track) } },
                active = currentKey == "${track.source}:${track.id}",
            )
        }
    }
}
