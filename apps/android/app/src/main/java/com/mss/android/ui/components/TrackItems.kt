package com.mss.android.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.MoreVert
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.mss.core.model.UnifiedTrack

@Composable
fun Cover(url: String?, modifier: Modifier = Modifier.size(48.dp)) {
    AsyncImage(
        model = url,
        contentDescription = null,
        contentScale = ContentScale.Crop,
        modifier = modifier.clip(RoundedCornerShape(8.dp)),
    )
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
) {
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onPlay).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Cover(track.coverUrl)
        Column(Modifier.weight(1f)) {
            Text(track.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            Text(track.artist, style = MaterialTheme.typography.bodySmall, maxLines = 1)
        }
        IconButton(onClick = onLike) {
            Icon(if (liked) Icons.Default.Favorite else Icons.Default.FavoriteBorder, contentDescription = "лайк")
        }
        IconButton(onClick = { menu = true }) {
            Icon(Icons.Default.MoreVert, contentDescription = "меню")
            DropdownMenu(menu, { menu = false }) {
                DropdownMenuItem(text = { Text("Скачать") }, onClick = { menu = false; onDownload() }, leadingIcon = { Icon(Icons.Default.Download, null) })
                onQueue?.let { DropdownMenuItem(text = { Text("В очередь") }, onClick = { menu = false; it() }) }
                onSimilar?.let { DropdownMenuItem(text = { Text("Похожие") }, onClick = { menu = false; it() }) }
                onWave?.let { DropdownMenuItem(text = { Text("Волна по треку") }, onClick = { menu = false; it() }) }
                onSuggest?.let { DropdownMenuItem(text = { Text("Предложить в лобби") }, onClick = { menu = false; it() }) }
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
) {
    LazyColumn {
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
            )
        }
    }
}
