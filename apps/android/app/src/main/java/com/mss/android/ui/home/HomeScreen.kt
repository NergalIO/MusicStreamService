package com.mss.android.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.EmptyState
import com.mss.android.ui.components.MediaTile
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.ScreenTitle
import com.mss.android.ui.components.SectionTitle
import com.mss.android.ui.components.TrackRow
import com.mss.android.ui.components.greeting
import com.mss.android.ui.theme.rememberMssWindow
import com.mss.android.ui.navigation.Routes
import com.mss.core.model.SourceId
import com.mss.core.model.WaveSettings
import com.mss.core.model.toUnifiedTrack

@Composable
fun HomeScreen(vm: MssViewModel, nav: NavHostController) {
    val source by vm.homeSource.collectAsState()
    val shelves by vm.shelves.collectAsState()
    val feed by vm.feed.collectAsState()
    val playlists by vm.playlists.collectAsState()
    val tracks by vm.tracks.collectAsState()
    val liked by vm.likedIds.collectAsState()
    val player by vm.playerState.collectAsState()
    val sources by vm.sources.collectAsState()
    val canSuggest by vm.canSuggestToLobby.collectAsState()
    val window = rememberMssWindow()
    LaunchedEffect(source) { vm.loadHome() }
    val empty = shelves == null && feed.isEmpty() && playlists.isEmpty() && tracks.isEmpty()
    val currentKey = player.current?.let { "${it.source}:${it.id}" }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        item { ScreenTitle(greeting()) }
        item {
            WaveHero(
                playing = player.playing && player.radio,
                title = player.current?.let { "${it.title} — ${it.artist}" },
                onPlay = { vm.startWave() },
                onOpen = { nav.navigate(Routes.WAVE) },
            )
        }
        item {
            LazyRow(
                Modifier.padding(vertical = 8.dp),
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(
                    listOf(
                        Triple(SourceId.LOCAL, "MSS", null),
                        Triple(SourceId.YANDEX, "Яндекс", sources.yandex),
                        Triple(SourceId.SPOTIFY, "Spotify", sources.spotify),
                        Triple(SourceId.VK, "VK", sources.vk),
                    ),
                ) { (s, label, status) ->
                    MssChip(
                        selected = source == s,
                        label = label,
                        caption = status?.let { sourceCaption(it) },
                        onClick = { vm.setHomeSource(s) },
                    )
                }
            }
        }
        if (empty) {
            item {
                EmptyState(
                    "Здесь появится ваша музыка",
                    "Подключите Яндекс, Spotify или VK в разделе «Ещё» — на чипе будет видно, какой сервис уже работает.",
                )
            }
        }
        if (source == SourceId.LOCAL) {
            shelves?.frequent?.takeIf { it.isNotEmpty() }?.let { list ->
                item { SectionTitle("Часто слушаете") }
                itemsIndexed(list) { i, t ->
                    val track = t.toUnifiedTrack()
                    TrackRow(
                        track, track.id in liked,
                        onPlay = { vm.play(list.map { it.toUnifiedTrack() }, i) },
                        onLike = { vm.toggleLike(track) },
                        onDownload = { vm.download(track) },
                        onSuggest = if (canSuggest) ({ vm.suggestToLobby(track) }) else null,
                        active = currentKey == "${track.source}:${track.id}",
                    )
                }
            }
            shelves?.forgotten?.takeIf { it.isNotEmpty() }?.let { list ->
                item { SectionTitle("Вы давно не слушали") }
                itemsIndexed(list) { i, t ->
                    val track = t.toUnifiedTrack()
                    TrackRow(
                        track, track.id in liked,
                        onPlay = { vm.play(list.map { it.toUnifiedTrack() }, i) },
                        onLike = { vm.toggleLike(track) },
                        onDownload = { vm.download(track) },
                        onSuggest = if (canSuggest) ({ vm.suggestToLobby(track) }) else null,
                        active = currentKey == "${track.source}:${track.id}",
                    )
                }
            }
        }
        feed.forEach { block ->
            item { SectionTitle(block.title) }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(block.items) { item ->
                        val title = item.playlist?.title ?: item.album?.title ?: item.track?.title ?: item.artist?.name ?: ""
                        val subtitle = item.album?.artist ?: item.track?.artist ?: item.playlist?.owner
                        val cover = item.playlist?.coverUrl ?: item.album?.coverUrl ?: item.track?.coverUrl ?: item.artist?.imageUrl
                        val open: () -> Unit = {
                            item.playlist?.let {
                                nav.navigate(
                                    if (it.source == SourceId.LOCAL) Routes.mssPlaylist(it.id)
                                    else Routes.playlist(it.source.name.lowercase(), it.id),
                                )
                            }
                            item.album?.let { nav.navigate(Routes.album(it.source.name.lowercase(), it.id)) }
                            item.track?.let { vm.play(listOf(it)) }
                            item.artist?.let { nav.navigate(Routes.artist(it.name)) }
                            Unit
                        }
                        MediaTile(
                            title = title,
                            subtitle = subtitle,
                            cover = cover,
                            size = window.shelf(),
                            onClick = open,
                            onPlay = item.track?.let { track -> { vm.play(listOf(track)); Unit } },
                        )
                    }
                }
            }
        }
        if (playlists.isNotEmpty()) {
            item { SectionTitle("Плейлисты") }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    items(playlists.take(12)) { p ->
                        MediaTile(
                            title = p.title,
                            subtitle = p.owner,
                            cover = p.coverUrl,
                            size = window.shelf(),
                            onClick = {
                                nav.navigate(
                                    if (p.source == SourceId.LOCAL) Routes.mssPlaylist(p.id)
                                    else Routes.playlist(p.source.name.lowercase(), p.id),
                                )
                            },
                        )
                    }
                }
            }
        }
        itemsIndexed(tracks) { i, track ->
            TrackRow(
                track, track.id in liked,
                onPlay = { vm.play(tracks, i) },
                onLike = { vm.toggleLike(track) },
                onDownload = { vm.download(track) },
                onSimilar = { nav.navigate(Routes.similar(track.source.name.lowercase(), track.id)) },
                onQueue = { vm.player.enqueue(track) },
                onWave = { vm.startWave(WaveSettings(seed = "track:${track.id}", seedTitle = track.title)) },
                onSuggest = if (canSuggest) ({ vm.suggestToLobby(track) }) else null,
                active = currentKey == "${track.source}:${track.id}",
            )
        }
    }
}

@Composable
private fun WaveHero(playing: Boolean, title: String?, onPlay: () -> Unit, onOpen: () -> Unit) {
    val primary = MaterialTheme.colorScheme.primary
    Box(
        Modifier
            .padding(horizontal = 16.dp, vertical = 8.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(Brush.linearGradient(listOf(primary.copy(alpha = 0.45f), primary.copy(alpha = 0.12f), MaterialTheme.colorScheme.surface)))
            .clickable(onClick = onOpen)
            .padding(20.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(
                Modifier
                    .size(56.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.onBackground)
                    .clickable(onClick = onPlay),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (playing) Icons.Default.Pause else Icons.Default.PlayArrow,
                    "Моя волна",
                    tint = MaterialTheme.colorScheme.background,
                    modifier = Modifier.size(32.dp),
                )
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Icon(Icons.Default.GraphicEq, null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("МОЯ ВОЛНА", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Text(
                    if (playing && title != null) title else "Музыка, которая подстраивается под вас",
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
    }
}

private fun sourceCaption(status: com.mss.core.connectors.AuthStatus): String = when (status) {
    com.mss.core.connectors.AuthStatus.CONNECTED -> "подключён"
    com.mss.core.connectors.AuthStatus.EXPIRED -> "войти снова"
    com.mss.core.connectors.AuthStatus.DISCONNECTED -> "не подключён"
}

