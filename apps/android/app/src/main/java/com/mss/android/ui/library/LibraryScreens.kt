package com.mss.android.ui.library

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.LibraryTab
import com.mss.android.ui.LibraryUi
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.EmptyState
import com.mss.android.ui.components.DownloadedGreen
import com.mss.android.ui.components.EntityRow
import com.mss.core.downloads.DownloadScheduler
import androidx.compose.material.icons.filled.DownloadForOffline
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.MssField
import com.mss.android.ui.components.ScreenTitle
import com.mss.android.ui.components.TrackList
import com.mss.android.ui.components.sourceLabel
import com.mss.android.ui.navigation.Routes
import com.mss.core.model.DownloadRecord
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.WaveSettings

private val SOURCE_ORDER = listOf(SourceId.LOCAL, SourceId.YANDEX, SourceId.SPOTIFY, SourceId.VK)

@Composable
fun LibraryScreen(vm: MssViewModel, nav: NavHostController) {
    val library by vm.library.collectAsState()
    val tab by vm.libraryTab.collectAsState()
    val source by vm.librarySource.collectAsState()
    LaunchedEffect(Unit) { vm.loadLibrary() }

    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(end = 8.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            ScreenTitle("Медиатека", Modifier.weight(1f))
            if (library.loading) {
                CircularProgressIndicator(Modifier.padding(12.dp).size(22.dp), strokeWidth = 2.dp)
            } else {
                IconButton({ vm.loadLibrary(force = true) }) { Icon(Icons.Default.Refresh, "Обновить") }
            }
        }
        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(LibraryTab.entries) { t -> MssChip(t == tab, t.title) { vm.setLibraryTab(t) } }
        }
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
                LibraryTab.TRACKS -> LikedTracksTab(vm, nav, library, activeSource)
                LibraryTab.PLAYLISTS -> PlaylistsTab(vm, nav, library, activeSource)
                LibraryTab.ARTISTS -> ArtistsTab(nav, library, activeSource)
                LibraryTab.ALBUMS -> AlbumsTab(vm, nav, library, activeSource)
                LibraryTab.DOWNLOADS -> DownloadsTab(vm, activeSource)
                LibraryTab.UPLOADS -> UploadsTab(vm, nav, library)
                LibraryTab.HISTORY -> HistoryTab(vm, nav, activeSource)
            }
        }
    }
}

@Composable
private fun SourceErrors(library: LibraryUi, source: SourceId?, tab: LibraryTab) {
    if (tab !in setOf(LibraryTab.TRACKS, LibraryTab.PLAYLISTS, LibraryTab.ARTISTS, LibraryTab.ALBUMS)) return
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

private fun List<UnifiedTrack>.bySource(source: SourceId?) = if (source == null) this else filter { it.source == source }

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
private fun LikedTracksTab(vm: MssViewModel, nav: NavHostController, library: LibraryUi, source: SourceId?) {
    val tracks = library.likedTracks(source)
    LoadingOr(
        loading = library.loading || !library.loaded,
        empty = tracks.isEmpty(),
        title = "Нет понравившихся треков",
        subtitle = if (source == null) "Ставьте лайки трекам — они соберутся здесь со всех подключённых сервисов." else "В ${sourceLabel(source)} пока нет лайков.",
    ) {
        TrackColumn(vm, nav, tracks) { playAllHeader(tracks.size) { vm.play(tracks, 0) } }
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
        onSimilar = { nav.navigate(Routes.similar(it.source.name.lowercase(), it.id)) },
        onQueue = { vm.player.enqueue(it) },
        onWave = { if (it.source == SourceId.YANDEX) vm.startWave(WaveSettings(seed = "track:${it.id}", seedTitle = it.title)) },
        onSuggest = if (canSuggest) ({ vm.suggestToLobby(it) }) else null,
        onQueueMany = { vm.enqueueMany(it) },
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
    val playlists = SOURCE_ORDER.filter { source == null || it == source }.flatMap { library.playlists[it].orEmpty() }
    val canCreate = source == null || source == SourceId.LOCAL
    var creating by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf<UnifiedPlaylist?>(null) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
        if (canCreate) {
            item(key = "create") {
                Row(
                    Modifier.fillMaxWidth().clickable { creating = true }.padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.primary)
                    Text("Новый плейлист", color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Medium)
                }
            }
        }
        if (playlists.isEmpty()) {
            item(key = "empty") {
                if (library.loading || !library.loaded) {
                    Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
                    }
                } else {
                    EmptyState("Плейлистов нет", "Создайте свой или подключите сервис в разделе «Ещё».")
                }
            }
        }
        items(playlists, key = { "${it.source}:${it.id}" }) { p ->
            EntityRow(
                title = p.title,
                subtitle = listOfNotNull(sourceLabel(p.source), p.trackCount?.let(::tracksWord), p.owner?.takeIf { it.isNotBlank() }).joinToString(" · "),
                cover = p.coverUrl,
                onClick = {
                    nav.navigate(
                        if (p.source == SourceId.LOCAL) Routes.mssPlaylist(p.id)
                        else Routes.playlist(p.source.name.lowercase(), p.id),
                    )
                },
                trailing = {
                    if (p.source == SourceId.LOCAL) {
                        IconButton({ deleting = p }) {
                            Icon(Icons.Default.Delete, "Удалить", tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                },
            )
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

private data class ArtistEntry(val name: String, val count: Int, val cover: String?, val sample: UnifiedTrack)

@Composable
private fun ArtistsTab(nav: NavHostController, library: LibraryUi, source: SourceId?) {
    val artists = remember(library.likes, source) {
        library.likedTracks(source)
            .groupBy { (it.artists?.firstOrNull()?.name ?: it.artist).trim().lowercase() }
            .filterKeys { it.isNotBlank() }
            .map { (_, list) ->
                val first = list.first()
                ArtistEntry(first.artists?.firstOrNull()?.name ?: first.artist, list.size, list.firstNotNullOfOrNull { it.coverUrl }, first)
            }
            .sortedWith(compareByDescending<ArtistEntry> { it.count }.thenBy { it.name.lowercase() })
    }
    LoadingOr(
        loading = library.loading || !library.loaded,
        empty = artists.isEmpty(),
        title = "Нет исполнителей",
        subtitle = "Исполнители появятся здесь по вашим лайкам.",
    ) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
            items(artists, key = { it.name.lowercase() }) { a ->
                EntityRow(a.name, "${tracksWord(a.count)} в лайках", a.cover, { nav.navigate(Routes.artist(a.sample)) })
            }
        }
    }
}

private data class AlbumEntry(val key: String, val title: String, val artist: String, val count: Int, val cover: String?, val sample: UnifiedTrack)

@Composable
private fun AlbumsTab(vm: MssViewModel, nav: NavHostController, library: LibraryUi, source: SourceId?) {
    val savedAll by vm.downloadedAlbums.collectAsState()
    val downloadedKeys by vm.downloadedKeys.collectAsState()
    val saved = savedAll.filter { source == null || it.source == source }
    val savedKeys = saved.map { "${it.source}:${it.id}" }.toSet()
    val albums = remember(library.likes, source, savedKeys) {
        library.likedTracks(source)
            .filter { !it.album.isNullOrBlank() || !it.albumId.isNullOrBlank() }
            .groupBy { "${it.source}:${it.albumId?.takeIf { id -> id.isNotBlank() } ?: it.album!!.lowercase()}" }
            .filterKeys { it !in savedKeys }
            .map { (key, list) ->
                val first = list.first()
                AlbumEntry(key, first.album?.ifBlank { null } ?: "Альбом", first.artist, list.size, first.coverUrl, first)
            }
            .sortedWith(compareByDescending<AlbumEntry> { it.count }.thenBy { it.title.lowercase() })
    }
    LoadingOr(
        loading = saved.isEmpty() && (library.loading || !library.loaded),
        empty = albums.isEmpty() && saved.isEmpty(),
        title = "Нет альбомов",
        subtitle = "Здесь появятся скачанные альбомы и альбомы понравившихся треков.",
    ) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 16.dp)) {
            if (saved.isNotEmpty()) {
                item(key = "saved-label") { AlbumSection("Скачанные") }
                items(saved, key = { "saved:${it.source}:${it.id}" }) { a ->
                    val done = a.tracks.count { DownloadScheduler.keyOf(it) in downloadedKeys }
                    EntityRow(
                        a.title,
                        listOf(a.artist, sourceLabel(a.source), "$done из ${a.tracks.size} скачано").filter { it.isNotBlank() }.joinToString(" · "),
                        a.coverUrl,
                        { nav.navigate(Routes.album(a.source.name.lowercase(), a.id)) },
                        trailing = {
                            Icon(
                                Icons.Filled.DownloadForOffline,
                                "Скачан",
                                tint = DownloadedGreen,
                                modifier = Modifier.padding(end = 12.dp),
                            )
                        },
                    )
                }
            }
            if (albums.isNotEmpty()) {
                if (saved.isNotEmpty()) item(key = "liked-label") { AlbumSection("Из понравившихся") }
                items(albums, key = { it.key }) { a ->
                    EntityRow(
                        a.title,
                        listOf(a.artist, sourceLabel(a.sample.source), "${tracksWord(a.count)} в лайках").filter { it.isNotBlank() }.joinToString(" · "),
                        a.cover,
                        { nav.navigate(Routes.album(a.sample)) },
                    )
                }
            }
        }
    }
}

@Composable
private fun AlbumSection(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.SemiBold,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
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
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri -> vm.registerUpload(uri, uploadTitle(context, uri), "Unknown") }
        if (uris.isNotEmpty()) vm.clearNeedFile()
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
                if (tracks.isEmpty() && library.loaded) {
                    Text(
                        "Здесь будут треки, которые вы загрузили в MSS со своего устройства.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun HistoryTab(vm: MssViewModel, nav: NavHostController, source: SourceId?) {
    val history by vm.playHistory.collectAsState()
    val tracks = history.bySource(source)
    var confirm by remember { mutableStateOf(false) }
    if (tracks.isEmpty()) {
        EmptyState("История пуста", "Здесь появятся треки, которые вы слушали.")
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
            text = { Text("Список недавно прослушанных треков будет удалён с этого устройства.") },
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
