package com.mss.android.ui.library

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.LibraryTab
import com.mss.android.ui.LibraryUi
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.barTab
import com.mss.android.ui.components.DownloadedGreen
import com.mss.android.ui.components.EmptyState
import com.mss.android.ui.components.EntityRow
import com.mss.android.ui.components.MediaTile
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.MssField
import com.mss.android.ui.components.ScreenTitle
import com.mss.android.ui.components.SectionTitle
import com.mss.android.ui.components.TrackList
import com.mss.android.ui.components.TrackRow
import com.mss.android.ui.components.sourceLabel
import com.mss.android.ui.navigation.Routes
import com.mss.android.ui.navigation.openRoute
import com.mss.android.ui.theme.rememberMssWindow
import com.mss.core.downloads.DownloadScheduler
import com.mss.core.model.AlbumWithTracks
import com.mss.core.model.DownloadRecord
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedAlbum
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.WaveSettings

private val SOURCE_ORDER = listOf(SourceId.LOCAL, SourceId.YANDEX, SourceId.SPOTIFY, SourceId.VK)
private const val SHELF_CARDS = 12
private const val TRACK_PREVIEW = 10
private val LikesRed = Color(0xFFE53935)
private val CollectionBar = LibraryTab.entries.filter { it.inBar }
private val CollectionPages = setOf(
    LibraryTab.COLLECTION,
    LibraryTab.TRACKS,
    LibraryTab.PLAYLISTS,
    LibraryTab.ARTISTS,
    LibraryTab.ALBUMS,
)

@Composable
fun LibraryScreen(vm: MssViewModel, nav: NavHostController) {
    val library by vm.library.collectAsState()
    val tab by vm.libraryTab.collectAsState()
    val source by vm.librarySource.collectAsState()
    LaunchedEffect(Unit) { vm.loadLibrary() }
    BackHandler(enabled = !tab.inBar) { vm.setLibraryTab(LibraryTab.COLLECTION) }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ScreenTitle("Медиатека", Modifier.weight(1f))
            if (library.loading) {
                CircularProgressIndicator(Modifier.padding(12.dp).size(22.dp), strokeWidth = 2.dp)
            } else {
                IconButton({ vm.loadLibrary(force = true) }) { Icon(Icons.Default.Refresh, "Обновить") }
            }
        }
        LibraryBar(tab.barTab) { vm.setLibraryTab(it) }
        val filterable = tab != LibraryTab.UPLOADS
        val sources = SOURCE_ORDER.filter { it in library.connected }
        if (filterable && sources.size > 1) {
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                item { MssChip(source == null, "Все") { vm.setLibrarySource(null) } }
                items(sources) { s -> MssChip(source == s, sourceLabel(s)) { vm.setLibrarySource(s) } }
            }
        }
        val activeSource = source.takeIf { filterable }
        SourceErrors(library, activeSource, tab)
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when (tab) {
                LibraryTab.COLLECTION -> CollectionHub(vm, nav, library, activeSource)
                LibraryTab.TRACKS -> LikedTracksTab(vm, nav, library, activeSource)
                LibraryTab.PLAYLISTS -> PlaylistsTab(vm, nav, library, activeSource)
                LibraryTab.ARTISTS -> ArtistsTab(vm, nav, library, activeSource)
                LibraryTab.ALBUMS -> AlbumsTab(vm, nav, library, activeSource)
                LibraryTab.DOWNLOADS -> DownloadsTab(vm, activeSource)
                LibraryTab.UPLOADS -> UploadsTab(vm, nav, library)
                LibraryTab.HISTORY -> HistoryTab(vm, nav, activeSource)
            }
        }
    }
}

@Composable
private fun LibraryBar(selected: LibraryTab, onSelect: (LibraryTab) -> Unit) {
    val scheme = MaterialTheme.colorScheme
    LazyRow(contentPadding = PaddingValues(horizontal = 8.dp)) {
        items(CollectionBar, key = { it.name }) { t ->
            val on = t == selected
            Column(
                Modifier.clickable { onSelect(t) }.padding(horizontal = 8.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(
                    t.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = if (on) FontWeight.SemiBold else FontWeight.Medium,
                    color = if (on) scheme.onSurface else scheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp, bottom = 6.dp),
                )
                Box(
                    Modifier
                        .height(2.dp)
                        .fillMaxWidth()
                        .background(if (on) scheme.primary else Color.Transparent, RoundedCornerShape(1.dp)),
                )
            }
        }
    }
}

@Composable
private fun SourceErrors(library: LibraryUi, source: SourceId?, tab: LibraryTab) {
    if (tab !in CollectionPages) return
    val shown = library.errors.filterKeys { source == null || it == source }
    if (shown.isEmpty()) return
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
        shown.forEach { (src, message) ->
            Text(
                "${sourceLabel(src)}: $message",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

private fun LibraryUi.likedTracks(source: SourceId?): List<UnifiedTrack> =
    SOURCE_ORDER.filter { source == null || it == source }.flatMap { likes[it].orEmpty() }

private fun LibraryUi.playlists(source: SourceId?): List<UnifiedPlaylist> =
    SOURCE_ORDER.filter { source == null || it == source }.flatMap { playlists[it].orEmpty() }

private fun List<UnifiedTrack>.bySource(source: SourceId?) = if (source == null) this else filter { it.source == source }

private fun playlistRoute(p: UnifiedPlaylist) =
    if (p.source == SourceId.LOCAL) Routes.mssPlaylist(p.id) else Routes.playlist(p.source.name.lowercase(), p.id)

@Composable
private fun LoadingOr(loading: Boolean, empty: Boolean, title: String, subtitle: String, content: @Composable () -> Unit) {
    when {
        empty && loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
        }
        empty -> EmptyState(title, subtitle)
        else -> content()
    }
}

@Composable
private fun CollectionHub(vm: MssViewModel, nav: NavHostController, library: LibraryUi, source: SourceId?) {
    val likes = library.likedTracks(source)
    val playlists = library.playlists(source)
    val artists = remember(library.likes, source) { favoriteArtists(library, source) }
    val savedAll by vm.downloadedAlbums.collectAsState()
    val albumShelf = remember(library.likes, library.albums, library.likedAlbums, savedAll, source) {
        albumShelfItems(vm, nav, library, source, savedAll)
    }
    val canCreate = source == null || source == SourceId.LOCAL
    var creating by remember { mutableStateOf(false) }
    val liked by vm.likedIds.collectAsState()
    val player by vm.playerState.collectAsState()
    val canSuggest by vm.canSuggestToLobby.collectAsState()
    val currentKey = player.current?.let { "${it.source}:${it.id}" }
    val size = rememberMssWindow().shelf()
    val empty = likes.isEmpty() && playlists.isEmpty() && artists.isEmpty() && albumShelf.isEmpty() && !canCreate
    LoadingOr(
        loading = library.loading || !library.loaded,
        empty = empty,
        title = "Медиатека пуста",
        subtitle = if (source == null) "Лайки, плейлисты и альбомы соберутся здесь." else "В ${sourceLabel(source)} пока ничего нет.",
    ) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
            val showPlaylists = likes.isNotEmpty() || playlists.isNotEmpty() || canCreate
            if (showPlaylists) {
                item(key = "playlists-title") {
                    SectionTitle("Плейлисты", action = "Все") { vm.setLibraryTab(LibraryTab.PLAYLISTS) }
                }
                item(key = "playlists-shelf") {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        if (likes.isNotEmpty()) {
                            item(key = "likes") {
                                ActionTile(
                                    size = size,
                                    title = "Мне нравится",
                                    subtitle = tracksWord(likes.size),
                                    color = LikesRed,
                                    icon = Icons.Default.Favorite,
                                    iconTint = Color.White,
                                    onClick = { vm.setLibraryTab(LibraryTab.TRACKS) },
                                    onPlay = { vm.play(likes, 0) },
                                )
                            }
                        }
                        if (canCreate) {
                            item(key = "create") {
                                ActionTile(
                                    size = size,
                                    title = "Новый плейлист",
                                    subtitle = null,
                                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
                                    icon = Icons.Default.Add,
                                    iconTint = MaterialTheme.colorScheme.primary,
                                    onClick = { creating = true },
                                )
                            }
                        }
                        items(playlists.take(SHELF_CARDS), key = { "${it.source}:${it.id}" }) { p ->
                            MediaTile(
                                title = p.title,
                                subtitle = listOfNotNull(sourceLabel(p.source), p.trackCount?.let(::tracksWord)).joinToString(" · "),
                                cover = p.coverUrl,
                                size = size,
                                onClick = { nav.openRoute(playlistRoute(p)) },
                                onPlay = { vm.playPlaylist(p) },
                            )
                        }
                    }
                }
            }
            if (albumShelf.isNotEmpty()) {
                item(key = "albums-title") {
                    SectionTitle("Альбомы", action = "Все") { vm.setLibraryTab(LibraryTab.ALBUMS) }
                }
                item(key = "albums-shelf") {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(albumShelf.take(SHELF_CARDS), key = { it.key }) { a ->
                            MediaTile(
                                title = a.title,
                                subtitle = a.subtitle,
                                cover = a.cover,
                                size = size,
                                onClick = a.onOpen,
                                onPlay = a.onPlay,
                            )
                        }
                    }
                }
            }
            if (artists.isNotEmpty()) {
                item(key = "artists-title") {
                    SectionTitle("Исполнители", action = "Все") { vm.setLibraryTab(LibraryTab.ARTISTS) }
                }
                item(key = "artists-shelf") {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        items(artists.take(SHELF_CARDS), key = { it.name.lowercase() }) { a ->
                            MediaTile(
                                title = a.name,
                                subtitle = tracksWord(a.count),
                                cover = a.cover,
                                size = size,
                                coverCorner = size / 2,
                                onClick = { nav.openRoute(Routes.artist(a.sample)) },
                                onPlay = { vm.play(a.tracks, 0) },
                            )
                        }
                    }
                }
            }
            if (likes.isNotEmpty()) {
                item(key = "tracks-title") {
                    SectionTitle("Треки", action = "Все") { vm.setLibraryTab(LibraryTab.TRACKS) }
                }
                itemsIndexed(likes.take(TRACK_PREVIEW), key = { _, t -> "${t.source}:${t.id}" }) { i, track ->
                    TrackRow(
                        track,
                        track.id in liked,
                        onPlay = { vm.play(likes, i) },
                        onLike = { vm.toggleLike(track) },
                        onDownload = { vm.download(track) },
                        onSimilar = { nav.openRoute(Routes.similar(track.source.name.lowercase(), track.id)) },
                        onQueue = { vm.player.enqueue(track) },
                        onWave = { if (track.source == SourceId.YANDEX) vm.startWave(WaveSettings(seed = "track:${track.id}", seedTitle = track.title)) },
                        onSuggest = if (canSuggest) ({ vm.suggestToLobby(track) }) else null,
                        active = currentKey == "${track.source}:${track.id}",
                    )
                }
            }
        }
    }
    if (creating) CreatePlaylistDialog(onDismiss = { creating = false }) { name -> vm.createPlaylist(name); creating = false }
}

private data class ShelfAlbum(
    val key: String,
    val title: String,
    val subtitle: String?,
    val cover: String?,
    val onOpen: () -> Unit,
    val onPlay: () -> Unit,
)

private fun albumShelfItems(
    vm: MssViewModel,
    nav: NavHostController,
    library: LibraryUi,
    source: SourceId?,
    savedAll: List<AlbumWithTracks>,
): List<ShelfAlbum> {
    val saved = savedAll.filter { source == null || it.source == source }
    val savedKeys = saved.map { "${it.source}:${it.id}" }.toSet()
    val liked = library.likedAlbums.filter { source == null || it.source == source }
    val likedKeys = liked.map { "${it.source}:${it.id}" }.toSet()
    val mine = (if (source == null || source == SourceId.LOCAL) library.albums else emptyList())
        .filter { "local:${it.id}" !in likedKeys }
    val fromLikes = albumsFromLikes(library, source, savedKeys, likedKeys)
    return buildList {
        liked.forEach { a ->
            add(
                ShelfAlbum(
                    "liked:${a.source}:${a.id}",
                    a.title,
                    a.artist,
                    a.coverUrl,
                    { nav.openRoute(Routes.album(a.source.name.lowercase(), a.id)) },
                    { vm.playAlbum(a) },
                ),
            )
        }
        mine.forEach { a ->
            add(
                ShelfAlbum(
                    "mine:${a.id}",
                    a.title,
                    a.artist,
                    a.coverUrl,
                    { nav.openRoute(Routes.album("local", a.id)) },
                    { vm.playAlbum(a) },
                ),
            )
        }
        saved.forEach { a ->
            add(
                ShelfAlbum(
                    "saved:${a.source}:${a.id}",
                    a.title,
                    a.artist,
                    a.coverUrl,
                    { nav.openRoute(Routes.album(a.source.name.lowercase(), a.id)) },
                    { vm.play(a.tracks, 0) },
                ),
            )
        }
        fromLikes.forEach { a ->
            add(
                ShelfAlbum(
                    a.key,
                    a.title,
                    a.artist,
                    a.cover,
                    { nav.openRoute(Routes.album(a.sample)) },
                    { vm.play(a.tracks, 0) },
                ),
            )
        }
    }
}

@Composable
private fun ActionTile(
    size: Dp,
    title: String,
    subtitle: String?,
    color: Color,
    icon: ImageVector,
    iconTint: Color,
    onClick: () -> Unit,
    onPlay: (() -> Unit)? = null,
) {
    Column(Modifier.width(size).clickable(onClick = onClick)) {
        Box {
            Box(
                Modifier.size(size).clip(RoundedCornerShape(10.dp)).background(color),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = title, tint = iconTint, modifier = Modifier.size(36.dp))
            }
            if (onPlay != null) {
                Box(
                    Modifier
                        .align(Alignment.BottomEnd)
                        .padding(8.dp)
                        .size(44.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary)
                        .clickable(onClick = onPlay),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Default.PlayArrow,
                        contentDescription = "Слушать $title",
                        tint = MaterialTheme.colorScheme.onPrimary,
                        modifier = Modifier.size(24.dp),
                    )
                }
            }
        }
        Text(
            title,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        if (!subtitle.isNullOrBlank()) {
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
}

@Composable
private fun LikedTracksTab(vm: MssViewModel, nav: NavHostController, library: LibraryUi, source: SourceId?) {
    val tracks = library.likedTracks(source)
    LoadingOr(
        loading = library.loading || !library.loaded,
        empty = tracks.isEmpty(),
        title = "Нет понравившихся треков",
        subtitle = if (source == null) "Ставьте лайки трекам — они соберутся здесь со всех подключённых сервисов." else "В ${sourceLabel(source)} пока нет лайков.",
    ) {
        TrackColumn(vm, nav, tracks)
    }
}

@Composable
private fun TrackColumn(
    vm: MssViewModel,
    nav: NavHostController,
    tracks: List<UnifiedTrack>,
    onDeleteMany: ((List<UnifiedTrack>) -> Unit)? = null,
    header: LazyListScope.() -> Unit = {},
) {
    val liked by vm.likedIds.collectAsState()
    val player by vm.playerState.collectAsState()
    val canSuggest by vm.canSuggestToLobby.collectAsState()
    val currentKey = player.current?.let { "${it.source}:${it.id}" }
    TrackList(
        tracks = tracks,
        liked = liked,
        onPlay = { list, i -> vm.play(list, i) },
        onLike = { vm.toggleLike(it) },
        onDownload = { vm.download(it) },
        onSimilar = { nav.openRoute(Routes.similar(it.source.name.lowercase(), it.id)) },
        onQueue = { vm.player.enqueue(it) },
        onWave = { if (it.source == SourceId.YANDEX) vm.startWave(WaveSettings(seed = "track:${it.id}", seedTitle = it.title)) },
        onSuggest = if (canSuggest) ({ vm.suggestToLobby(it) }) else null,
        onQueueMany = { vm.enqueueMany(it) },
        onPublishMany = { vm.publishTracksToMss(it) },
        onDeleteMany = onDeleteMany,
        currentKey = currentKey,
        header = header,
    )
}

private fun LazyListScope.playAllHeader(count: Int, trailing: (@Composable () -> Unit)? = null, onPlay: () -> Unit) {
    item(key = "header") {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(tracksWord(count), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
            trailing?.invoke()
            Button(onClick = onPlay) {
                Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
                Text("Слушать", Modifier.padding(start = 4.dp))
            }
        }
    }
}

@Composable
private fun PlaylistsTab(vm: MssViewModel, nav: NavHostController, library: LibraryUi, source: SourceId?) {
    val playlists = library.playlists(source)
    val likes = library.likedTracks(source)
    val canCreate = source == null || source == SourceId.LOCAL
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<UnifiedPlaylist?>(null) }
    val window = rememberMssWindow()
    val cell = ((window.widthDp - 44) / 2).coerceAtLeast(120).dp
    val empty = playlists.isEmpty() && likes.isEmpty() && !canCreate
    LoadingOr(
        loading = library.loading || !library.loaded,
        empty = empty,
        title = "Плейлистов нет",
        subtitle = "Создайте свой или подключите сервис в разделе «Ещё».",
    ) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, top = 0.dp, end = 16.dp, bottom = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (likes.isNotEmpty()) {
                item(key = "likes") {
                    ActionTile(
                        size = cell,
                        title = "Мне нравится",
                        subtitle = tracksWord(likes.size),
                        color = LikesRed,
                        icon = Icons.Default.Favorite,
                        iconTint = Color.White,
                        onClick = { vm.setLibraryTab(LibraryTab.TRACKS) },
                        onPlay = { vm.play(likes, 0) },
                    )
                }
            }
            if (canCreate) {
                item(key = "create") {
                    ActionTile(
                        size = cell,
                        title = "Новый плейлист",
                        subtitle = null,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f),
                        icon = Icons.Default.Add,
                        iconTint = MaterialTheme.colorScheme.primary,
                        onClick = { creating = true },
                    )
                }
            }
            if (playlists.isEmpty() && !library.loaded) {
                item(key = "loading", span = { GridItemSpan(2) }) {
                    Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
                    }
                }
            }
            items(playlists, key = { "${it.source}:${it.id}" }) { p ->
                Box {
                    MediaTile(
                        title = p.title,
                        subtitle = listOfNotNull(sourceLabel(p.source), p.trackCount?.let(::tracksWord), p.owner?.takeIf { it.isNotBlank() }).joinToString(" · "),
                        cover = p.coverUrl,
                        size = cell,
                        onClick = { nav.openRoute(playlistRoute(p)) },
                        onPlay = { vm.playPlaylist(p) },
                    )
                    if (p.source == SourceId.LOCAL) {
                        IconButton(
                            { deleting = p },
                            Modifier.align(Alignment.TopEnd).padding(4.dp),
                        ) {
                            Icon(Icons.Default.Delete, "Удалить", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
    if (creating) CreatePlaylistDialog(onDismiss = { creating = false }) { name -> vm.createPlaylist(name); creating = false }
    deleting?.let { p ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Удалить плейлист?") },
            text = { Text("«${p.title}» будет удалён без возможности восстановления.") },
            confirmButton = {
                TextButton({ vm.deletePlaylist(p.id); deleting = null }) { Text("Удалить", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton({ deleting = null }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun CreatePlaylistDialog(onDismiss: () -> Unit, onCreate: (String) -> Unit) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Новый плейлист") },
        text = { MssField(name, { name = it }, placeholder = "Название", modifier = Modifier.fillMaxWidth()) },
        confirmButton = { TextButton({ onCreate(name) }, enabled = name.isNotBlank()) { Text("Создать") } },
        dismissButton = { TextButton(onDismiss) { Text("Отмена") } },
    )
}

private data class ArtistEntry(
    val name: String,
    val count: Int,
    val cover: String?,
    val sample: UnifiedTrack,
    val tracks: List<UnifiedTrack>,
)

private fun favoriteArtists(library: LibraryUi, source: SourceId?): List<ArtistEntry> =
    library.likedTracks(source)
        .groupBy { (it.artists?.firstOrNull()?.name ?: it.artist).trim().lowercase() }
        .filterKeys { it.isNotBlank() }
        .map { (_, list) ->
            val first = list.first()
            ArtistEntry(
                name = first.artists?.firstOrNull()?.name ?: first.artist,
                count = list.size,
                cover = list.firstNotNullOfOrNull { it.coverUrl },
                sample = first,
                tracks = list,
            )
        }
        .sortedWith(compareByDescending<ArtistEntry> { it.count }.thenBy { it.name.lowercase() })

@Composable
private fun ArtistsTab(vm: MssViewModel, nav: NavHostController, library: LibraryUi, source: SourceId?) {
    val artists = remember(library.likes, source) { favoriteArtists(library, source) }
    LoadingOr(
        loading = library.loading || !library.loaded,
        empty = artists.isEmpty(),
        title = "Нет исполнителей",
        subtitle = "Исполнители появятся здесь по вашим лайкам.",
    ) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
            items(artists, key = { it.name.lowercase() }) { a ->
                EntityRow(
                    title = a.name,
                    subtitle = "${tracksWord(a.count)} в лайках",
                    cover = a.cover,
                    onClick = { nav.openRoute(Routes.artist(a.sample)) },
                    coverCorner = 24.dp,
                    trailing = {
                        IconButton({ vm.play(a.tracks, 0) }) {
                            Icon(Icons.Default.PlayArrow, "Слушать", tint = MaterialTheme.colorScheme.primary)
                        }
                    },
                )
            }
        }
    }
}

private data class AlbumEntry(
    val key: String,
    val title: String,
    val artist: String,
    val count: Int,
    val cover: String?,
    val sample: UnifiedTrack,
    val tracks: List<UnifiedTrack>,
)

private fun albumsFromLikes(
    library: LibraryUi,
    source: SourceId?,
    savedKeys: Set<String>,
    likedKeys: Set<String>,
): List<AlbumEntry> =
    library.likedTracks(source)
        .filter { !it.album.isNullOrBlank() || !it.albumId.isNullOrBlank() }
        .groupBy { "${it.source}:${it.albumId?.takeIf { id -> id.isNotBlank() } ?: it.album!!.lowercase()}" }
        .filterKeys { it !in savedKeys && it !in likedKeys }
        .map { (key, list) ->
            val first = list.first()
            AlbumEntry(
                key = key,
                title = first.album?.ifBlank { null } ?: "Альбом",
                artist = first.artist,
                count = list.size,
                cover = first.coverUrl,
                sample = first,
                tracks = list,
            )
        }
        .sortedWith(compareByDescending<AlbumEntry> { it.count }.thenBy { it.title.lowercase() })

@Composable
private fun AlbumsTab(vm: MssViewModel, nav: NavHostController, library: LibraryUi, source: SourceId?) {
    val savedAll by vm.downloadedAlbums.collectAsState()
    val downloadedKeys by vm.downloadedKeys.collectAsState()
    val saved = savedAll.filter { source == null || it.source == source }
    val savedKeys = saved.map { "${it.source}:${it.id}" }.toSet()
    val liked = library.likedAlbums.filter { source == null || it.source == source }
    val likedKeys = liked.map { "${it.source}:${it.id}" }.toSet()
    val mine = (if (source == null || source == SourceId.LOCAL) library.albums else emptyList())
        .filter { "local:${it.id}" !in likedKeys }
    var deleting by remember { mutableStateOf<UnifiedAlbum?>(null) }
    val albums = remember(library.likes, source, savedKeys, likedKeys) {
        albumsFromLikes(library, source, savedKeys, likedKeys)
    }
    val window = rememberMssWindow()
    val cell = ((window.widthDp - 44) / 2).coerceAtLeast(120).dp
    LoadingOr(
        loading = saved.isEmpty() && mine.isEmpty() && liked.isEmpty() && (library.loading || !library.loaded),
        empty = albums.isEmpty() && saved.isEmpty() && mine.isEmpty() && liked.isEmpty(),
        title = "Нет альбомов",
        subtitle = "Загрузите альбом в «Мои файлы» или поставьте лайк альбому — он появится здесь.",
    ) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, top = 0.dp, end = 16.dp, bottom = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (liked.isNotEmpty()) {
                item(key = "liked-albums-label", span = { GridItemSpan(2) }) { AlbumSection("Понравившиеся") }
                items(liked, key = { "liked:${it.source}:${it.id}" }) { a ->
                    Box {
                        MediaTile(
                            title = a.title,
                            subtitle = listOf(a.artist, sourceLabel(a.source), a.year?.toString(), a.trackCount?.let { tracksWord(it) }).filterNotNull().joinToString(" · "),
                            cover = a.coverUrl,
                            size = cell,
                            onClick = { nav.openRoute(Routes.album(a.source.name.lowercase(), a.id)) },
                            onPlay = { vm.playAlbum(a) },
                        )
                        IconButton({ vm.toggleAlbumLike(a) }, Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                            Icon(Icons.Default.Favorite, "Убрать из «Мне нравится»", tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
            if (mine.isNotEmpty()) {
                item(key = "mine-label", span = { GridItemSpan(2) }) { AlbumSection("Мои альбомы") }
                items(mine, key = { "mine:${it.id}" }) { a ->
                    Box {
                        MediaTile(
                            title = a.title,
                            subtitle = listOf(a.artist, a.year?.toString(), a.trackCount?.let { tracksWord(it) }).filterNotNull().joinToString(" · "),
                            cover = a.coverUrl,
                            size = cell,
                            onClick = { nav.openRoute(Routes.album("local", a.id)) },
                            onPlay = { vm.playAlbum(a) },
                        )
                        IconButton({ deleting = a }, Modifier.align(Alignment.TopEnd).padding(4.dp)) {
                            Icon(Icons.Default.Delete, "Удалить", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            if (saved.isNotEmpty()) {
                item(key = "saved-label", span = { GridItemSpan(2) }) { AlbumSection("Скачанные") }
                items(saved, key = { "saved:${it.source}:${it.id}" }) { a ->
                    val done = a.tracks.count { DownloadScheduler.keyOf(it) in downloadedKeys }
                    Box {
                        MediaTile(
                            title = a.title,
                            subtitle = listOf(a.artist, sourceLabel(a.source), "$done из ${a.tracks.size} скачано").filter { it.isNotBlank() }.joinToString(" · "),
                            cover = a.coverUrl,
                            size = cell,
                            onClick = { nav.openRoute(Routes.album(a.source.name.lowercase(), a.id)) },
                            onPlay = { vm.play(a.tracks, 0) },
                        )
                        Icon(
                            Icons.Filled.DownloadForOffline,
                            "Скачан",
                            tint = DownloadedGreen,
                            modifier = Modifier.align(Alignment.TopEnd).padding(12.dp),
                        )
                    }
                }
            }
            if (albums.isNotEmpty()) {
                if (liked.isNotEmpty() || saved.isNotEmpty() || mine.isNotEmpty()) {
                    item(key = "from-likes-label", span = { GridItemSpan(2) }) { AlbumSection("Из понравившихся треков") }
                }
                items(albums, key = { it.key }) { a ->
                    MediaTile(
                        title = a.title,
                        subtitle = listOf(a.artist, sourceLabel(a.sample.source), "${tracksWord(a.count)} в лайках").filter { it.isNotBlank() }.joinToString(" · "),
                        cover = a.cover,
                        size = cell,
                        onClick = { nav.openRoute(Routes.album(a.sample)) },
                        onPlay = { vm.play(a.tracks, 0) },
                    )
                }
            }
        }
    }
    deleting?.let { a ->
        AlertDialog(
            onDismissRequest = { deleting = null },
            title = { Text("Удалить альбом?") },
            text = { Text("«${a.title}» будет удалён из библиотеки. Треки останутся в «Мои файлы».") },
            confirmButton = {
                TextButton({ vm.deleteAlbum(a.id); deleting = null }) { Text("Удалить", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton({ deleting = null }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun AlbumSection(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(vertical = 8.dp),
    )
}

@Composable
private fun DownloadsTab(vm: MssViewModel, source: SourceId?) {
    val records by vm.downloadRecords.collectAsState()
    val shown = records.filter { source == null || it.track.source == source }
    var removing by remember { mutableStateOf<DownloadRecord?>(null) }
    if (shown.isEmpty()) {
        EmptyState("Ничего не скачано", "Скачайте трек из меню «⋮» — он будет доступен без интернета.")
        return
    }
    val tracks = shown.map { it.track }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        playAllHeader(tracks.size) { vm.play(tracks, 0) }
        itemsIndexed(shown, key = { _, r -> r.key }) { i, r ->
            EntityRow(
                title = r.track.title,
                subtitle = listOfNotNull(r.track.artist.ifBlank { null }, sourceLabel(r.track.source), formatSize(r.size)).joinToString(" · "),
                cover = r.track.coverUrl,
                onClick = { vm.play(tracks, i) },
                trailing = {
                    IconButton({ removing = r }) {
                        Icon(Icons.Default.Delete, "Удалить", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                },
            )
        }
    }
    removing?.let { r ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("Удалить загрузку?") },
            text = { Text("«${r.track.title}» будет удалён с устройства.") },
            confirmButton = {
                TextButton({ vm.removeDownload(r.key); removing = null }) { Text("Удалить", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = { TextButton({ removing = null }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun UploadsTab(vm: MssViewModel, nav: NavHostController, library: LibraryUi) {
    val context = LocalContext.current
    val need by vm.needFile.collectAsState()
    var albumUris by remember { mutableStateOf<List<Uri>?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri -> vm.registerUpload(uri, uploadTitle(context, uri), "Unknown") }
        if (uris.isNotEmpty()) vm.clearNeedFile()
    }
    val albumLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        if (uris.isNotEmpty()) albumUris = uris
    }
    val tracks = library.uploads
    TrackColumn(vm, nav, tracks, onDeleteMany = { vm.deleteUploads(it) }) {
        item(key = "upload") {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                need?.let {
                    Text(
                        "Для эфира нужен файл: ${it.title ?: it.trackId}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Button({ launcher.launch(arrayOf("audio/*")) }, Modifier.fillMaxWidth()) {
                    Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                    Text("Добавить файлы с устройства", Modifier.padding(start = 6.dp))
                }
                OutlinedButton({ albumLauncher.launch(arrayOf("audio/*")) }, Modifier.fillMaxWidth()) {
                    Text("Загрузить альбом")
                }
                if (tracks.isEmpty() && library.loaded) {
                    Text(
                        "Треки загружаются в облако по одному. Альбом — обложка и список ссылок на эти треки.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
    albumUris?.let { uris ->
        AlbumUploadDialog(
            defaultTitle = uploadTitle(context, uris.first()),
            onDismiss = { albumUris = null },
            onConfirm = { title: String, artist: String, cover: Uri? ->
                vm.registerUploadAlbum(uris, title, artist, cover)
                albumUris = null
            },
        )
    }
}

@Composable
private fun AlbumUploadDialog(
    defaultTitle: String,
    onDismiss: () -> Unit,
    onConfirm: (String, String, Uri?) -> Unit,
) {
    var title by remember { mutableStateOf(defaultTitle.ifBlank { "Альбом" }) }
    var artist by remember { mutableStateOf("") }
    var coverUri by remember { mutableStateOf<Uri?>(null) }
    val coverLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) coverUri = uri
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Новый альбом") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MssField(title, { title = it }, placeholder = "Название", modifier = Modifier.fillMaxWidth())
                MssField(artist, { artist = it }, placeholder = "Исполнитель", modifier = Modifier.fillMaxWidth())
                TextButton({ coverLauncher.launch("image/*") }) {
                    Text(if (coverUri != null) "Обложка выбрана" else "Выбрать обложку")
                }
            }
        },
        confirmButton = {
            TextButton(
                { onConfirm(title.trim().ifBlank { "Альбом" }, artist.trim().ifBlank { "Неизвестный исполнитель" }, coverUri) },
                enabled = title.isNotBlank(),
            ) { Text("Загрузить") }
        },
        dismissButton = { TextButton(onDismiss) { Text("Отмена") } },
    )
}

@Composable
private fun HistoryTab(vm: MssViewModel, nav: NavHostController, source: SourceId?) {
    LaunchedEffect(Unit) { vm.refreshPlayHistory() }
    val history by vm.playHistory.collectAsState()
    val tracks = history.bySource(source)
    var confirm by remember { mutableStateOf(false) }
    if (tracks.isEmpty()) {
        EmptyState("История пуста", "Здесь появятся треки, которые вы слушали на телефоне или компьютере.")
        return
    }
    TrackColumn(vm, nav, tracks) {
        playAllHeader(
            tracks.size,
            trailing = { TextButton({ confirm = true }) { Text("Очистить") } },
        ) { vm.play(tracks, 0) }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Очистить историю?") },
            text = { Text("Список на этом устройстве будет скрыт. Статистика прослушиваний сохранится.") },
            confirmButton = { TextButton({ vm.clearPlayHistory(); confirm = false }) { Text("Очистить", color = MaterialTheme.colorScheme.error) } },
            dismissButton = { TextButton({ confirm = false }) { Text("Отмена") } },
        )
    }
}

private fun uploadTitle(context: Context, uri: Uri): String {
    val name = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    }.getOrNull() ?: uri.lastPathSegment ?: "track"
    return name.substringBeforeLast('.').ifBlank { name }
}

private fun tracksWord(n: Int): String {
    val mod100 = n % 100
    val mod10 = n % 10
    val word = when {
        mod100 in 11..14 -> "треков"
        mod10 == 1 -> "трек"
        mod10 in 2..4 -> "трека"
        else -> "треков"
    }
    return "$n $word"
}

private fun formatSize(bytes: Long): String? = when {
    bytes <= 0 -> null
    bytes >= 1_048_576 -> String.format(java.util.Locale("ru"), "%.1f МБ", bytes / 1_048_576.0)
    else -> "${bytes / 1024} КБ"
}
