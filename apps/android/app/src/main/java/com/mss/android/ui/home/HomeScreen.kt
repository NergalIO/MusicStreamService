package com.mss.android.ui.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.Cover
import com.mss.android.ui.components.TrackRow
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
    LaunchedEffect(source) { vm.loadHome() }
    LazyColumn {
        item {
            LazyRow(Modifier.padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf(SourceId.LOCAL to "MSS", SourceId.YANDEX to "Яндекс", SourceId.SPOTIFY to "Spotify", SourceId.VK to "VK")) { (s, label) ->
                    FilterChip(selected = source == s, onClick = { vm.setHomeSource(s) }, label = { Text(label) })
                }
            }
        }
        if (source == SourceId.LOCAL) {
            shelves?.frequent?.takeIf { it.isNotEmpty() }?.let { list ->
                item { Text("Часто слушаете", modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.titleMedium) }
                itemsIndexed(list) { i, t ->
                    val track = t.toUnifiedTrack()
                    TrackRow(
                        track, track.id in liked,
                        onPlay = { vm.play(list.map { it.toUnifiedTrack() }, i) },
                        onLike = { vm.toggleLike(track) },
                        onDownload = { vm.download(track) },
                    )
                }
            }
            shelves?.forgotten?.takeIf { it.isNotEmpty() }?.let { list ->
                item { Text("Вы давно не слушали", modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.titleMedium) }
                itemsIndexed(list) { i, t ->
                    val track = t.toUnifiedTrack()
                    TrackRow(
                        track, track.id in liked,
                        onPlay = { vm.play(list.map { it.toUnifiedTrack() }, i) },
                        onLike = { vm.toggleLike(track) },
                        onDownload = { vm.download(track) },
                    )
                }
            }
        }
        feed.forEach { block ->
            item { Text(block.title, modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.titleMedium) }
            item {
                LazyRow {
                    items(block.items) { item ->
                        val title = item.playlist?.title ?: item.album?.title ?: item.track?.title ?: item.artist?.name ?: ""
                        val cover = item.playlist?.coverUrl ?: item.album?.coverUrl ?: item.track?.coverUrl ?: item.artist?.imageUrl
                        Column(
                            Modifier.padding(8.dp).clickable {
                                item.playlist?.let { nav.navigate(if (it.source == SourceId.LOCAL) Routes.mssPlaylist(it.id) else Routes.playlist(it.source.name.lowercase(), it.id)) }
                                item.album?.let { nav.navigate(Routes.album(it.source.name.lowercase(), it.id)) }
                                item.track?.let { vm.play(listOf(it)) }
                                item.artist?.let { nav.navigate(Routes.artist(it.name)) }
                            },
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Cover(cover, Modifier.height(120.dp).fillMaxWidth())
                            Text(title, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                        }
                    }
                }
            }
        }
        if (playlists.isNotEmpty()) {
            item { Text("Плейлисты", modifier = Modifier.padding(16.dp), style = MaterialTheme.typography.titleMedium) }
            item {
                LazyRow {
                    items(playlists.take(12)) { p ->
                        Column(
                            Modifier.padding(8.dp).clickable {
                                nav.navigate(if (p.source == SourceId.LOCAL) Routes.mssPlaylist(p.id) else Routes.playlist(p.source.name.lowercase(), p.id))
                            },
                        ) {
                            Cover(p.coverUrl, Modifier.height(100.dp))
                            Text(p.title, style = MaterialTheme.typography.bodySmall, maxLines = 1)
                        }
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
                onSuggest = { vm.suggestToLobby(track) },
            )
        }
    }
}
