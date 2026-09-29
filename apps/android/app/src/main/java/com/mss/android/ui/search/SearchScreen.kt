package com.mss.android.ui.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.EmptyState
import com.mss.android.ui.components.EntityRow
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.MssField
import com.mss.android.ui.components.ScreenTitle
import com.mss.android.ui.components.SectionTitle
import com.mss.android.ui.components.TrackRow
import com.mss.android.ui.navigation.Routes
import com.mss.core.model.SourceId
import com.mss.core.model.WaveSettings

@Composable
fun SearchScreen(vm: MssViewModel, nav: NavHostController) {
    var q by remember { mutableStateOf("") }
    var source by remember { mutableStateOf<SourceId?>(null) }
    var kind by remember { mutableStateOf("all") }
    val history by vm.searchHistory.collectAsState()
    val albums by vm.albums.collectAsState()
    val playlists by vm.searchPlaylists.collectAsState()
    val artists by vm.searchArtists.collectAsState()
    val tracks by vm.tracks.collectAsState()
    val liked by vm.likedIds.collectAsState()
    val player by vm.playerState.collectAsState()
    val error by vm.error.collectAsState()
    val canSuggest by vm.canSuggestToLobby.collectAsState()
    var didSearch by remember { mutableStateOf(false) }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }
    val currentKey = player.current?.let { "${it.source}:${it.id}" }
    val runSearch = {
        if (q.isNotBlank()) {
            didSearch = true
            vm.search(q, source, kind)
        }
    }
    val showTracks = kind == "all" || kind == "tracks"
    val showAlbums = kind == "all" || kind == "albums"
    val showArtists = kind == "all" || kind == "artists"
    val showPlaylists = kind == "all" || kind == "playlists"
    val nothing = didSearch && tracks.isEmpty() && albums.isEmpty() && playlists.isEmpty() && artists.isEmpty()

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        item {
            ScreenTitle("Поиск")
            MssField(
                q,
                { q = it },
                placeholder = "Треки, артисты, альбомы",
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).focusRequester(focus),
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { runSearch() }),
            )
        }
        item {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(
                    listOf(
                        null to "Все",
                        SourceId.LOCAL to "MSS",
                        SourceId.YANDEX to "Яндекс",
                        SourceId.SPOTIFY to "Spotify",
                        SourceId.VK to "VK",
                    ),
                ) { (s, label) ->
                    MssChip(source == s, label) { source = s }
                }
            }
        }
        item {
            LazyRow(
                contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(listOf("all" to "Все", "tracks" to "Треки", "artists" to "Артисты", "albums" to "Альбомы", "playlists" to "Плейлисты")) { (k, label) ->
                    MssChip(kind == k, label) { kind = k }
                }
            }
        }
        if (!didSearch && q.isBlank() && history.isNotEmpty()) {
            item { SectionTitle("Недавние") }
            items(history.take(8)) { h ->
                Text(
                    h,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            q = h
                            didSearch = true
                            vm.search(h, source, kind)
                        }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
        if (didSearch && error != null && nothing) {
            item { EmptyState("Не удалось выполнить поиск", "Проверьте соединение и нажмите поиск ещё раз.") }
        } else if (nothing) {
            item { EmptyState("Ничего не найдено", "Попробуйте другой запрос или источник.") }
        }
        if (showAlbums && albums.isNotEmpty()) {
            item { SectionTitle("Альбомы") }
            items(albums, key = { "a:${it.source}:${it.id}" }) { a ->
                EntityRow(a.title, a.artist, a.coverUrl, { nav.navigate(Routes.album(a.source.name.lowercase(), a.id)) })
            }
        }
        if (showArtists && artists.isNotEmpty()) {
            item { SectionTitle("Артисты") }
            items(artists, key = { "ar:${it.name}" }) { a ->
                EntityRow(a.name, null, a.imageUrl, { nav.navigate(Routes.artist(a.name)) })
            }
        }
        if (showPlaylists && playlists.isNotEmpty()) {
            item { SectionTitle("Плейлисты") }
            items(playlists, key = { "p:${it.source}:${it.id}" }) { p ->
                EntityRow(p.title, p.owner, p.coverUrl, {
                    nav.navigate(if (p.source == SourceId.LOCAL) Routes.mssPlaylist(p.id) else Routes.playlist(p.source.name.lowercase(), p.id))
                })
            }
        }
        if (showTracks && tracks.isNotEmpty()) {
            item { SectionTitle("Треки") }
            itemsIndexed(tracks, key = { i, t -> "${t.source}:${t.id}:$i" }) { i, track ->
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
}
