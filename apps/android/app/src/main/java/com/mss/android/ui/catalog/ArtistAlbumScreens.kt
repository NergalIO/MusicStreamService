package com.mss.android.ui.catalog

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.AlbumPageUi
import com.mss.android.ui.ArtistPageUi
import com.mss.android.ui.ArtistPlatformUi
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.Cover
import com.mss.android.ui.components.MediaTile
import com.mss.android.ui.components.MssChip
import com.mss.android.ui.components.DownloadedGreen
import com.mss.android.ui.components.canDownload
import com.mss.core.downloads.DownloadScheduler
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.outlined.CloudUpload
import androidx.compose.material.icons.outlined.DownloadForOffline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.TextButton
import androidx.compose.runtime.remember
import com.mss.core.model.AlbumWithTracks
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import com.mss.android.ui.components.SourceTag
import com.mss.android.ui.components.TrackList
import com.mss.android.ui.components.TrackRow
import com.mss.android.ui.components.sourceLabel
import com.mss.android.ui.navigation.Routes
import com.mss.android.ui.navigation.openRoute
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.WaveSettings
import com.mss.core.model.localArtistLikeId
import java.util.Locale

private val SOURCE_ORDER = listOf(SourceId.LOCAL, SourceId.YANDEX, SourceId.SPOTIFY, SourceId.VK)

@Composable
fun ArtistScreen(vm: MssViewModel, nav: NavHostController) {
    val page by vm.artistPage.collectAsState()
    val liked by vm.likedIds.collectAsState()
    val likedArtists by vm.likedArtists.collectAsState()
    val player by vm.playerState.collectAsState()
    val canSuggest by vm.canSuggestToLobby.collectAsState()
    val currentKey = player.current?.let { "${it.source}:${it.id}" }
    val scheme = MaterialTheme.colorScheme
    val present = page.platforms.filter { it.present }.sortedBy { SOURCE_ORDER.indexOf(it.source) }
    val missing = page.platforms.filter { !it.present && it.source != SourceId.LOCAL }
    var picked by rememberSaveable(page.name) { mutableStateOf<SourceId?>(null) }
    val selected = picked?.takeIf { p -> present.any { it.source == p } }
        ?: present.firstOrNull { it.source == page.preferred }?.source
        ?: present.firstOrNull()?.source
    var aboutOpen by rememberSaveable(page.name) { mutableStateOf(false) }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Cover(page.imageUrl, Modifier.size(168.dp), corner = 84.dp)
                Text("Исполнитель", style = MaterialTheme.typography.labelMedium, color = scheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp))
                Text(
                    page.name.ifBlank { "…" },
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                val likeId = localArtistLikeId(page.name)
                val artistLiked = likedArtists.any {
                    it.source == SourceId.LOCAL && (it.id == likeId || it.name.equals(page.name, ignoreCase = true))
                }
                IconButton({
                    vm.toggleArtistLike(
                        page.name,
                        page.imageUrl,
                        page.genres,
                        page.tracksBySource[SourceId.LOCAL].orEmpty().size,
                    )
                }) {
                    Icon(
                        if (artistLiked) Icons.Filled.Favorite else Icons.Filled.FavoriteBorder,
                        if (artistLiked) "Убрать из «Мне нравится»" else "Мне нравится",
                        tint = if (artistLiked) MaterialTheme.colorScheme.primary else scheme.onSurfaceVariant,
                    )
                }
                totalListeners(present)?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium, color = scheme.onSurfaceVariant)
                }
                if (page.genres.isNotEmpty()) {
                    Text(page.genres.take(4).joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant, textAlign = TextAlign.Center)
                }
            }
        }
        if (page.loading) {
            item {
                Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center) {
                    CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
                }
            }
        }
        if (present.isNotEmpty()) {
            item { SectionLabel("Площадки") }
            item {
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(present, key = { "plat:${it.source}" }) { platform ->
                        PlatformCard(platform, platform.source == selected) { picked = platform.source }
                    }
                }
            }
            if (missing.isNotEmpty()) {
                item {
                    Text(
                        "Нет на: ${missing.joinToString { sourceLabel(it.source) }}",
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = scheme.onSurfaceVariant,
                    )
                }
            }
        }
        page.description?.let { text ->
            item {
                Column(Modifier.fillMaxWidth().clickable { aboutOpen = !aboutOpen }.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text("Об исполнителе", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        text,
                        modifier = Modifier.padding(top = 4.dp).animateContentSize(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = scheme.onSurfaceVariant,
                        maxLines = if (aboutOpen) Int.MAX_VALUE else 4,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(if (aboutOpen) "Свернуть" else "Подробнее", style = MaterialTheme.typography.labelLarge, color = scheme.primary, modifier = Modifier.padding(top = 4.dp))
                }
            }
        }
        if (present.size > 1) {
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(present, key = { "chip:${it.source}" }) { platform ->
                        FilterChip(
                            selected = platform.source == selected,
                            onClick = { picked = platform.source },
                            label = { Text(sourceLabel(platform.source)) },
                        )
                    }
                }
            }
        }
        if (selected != null) {
            val label = sourceLabel(selected)
            val popular = page.popularBySource[selected].orEmpty()
            if (popular.isNotEmpty()) {
                item { SectionLabel("Популярные · $label") }
                itemsIndexed(popular, key = { i, t -> "pop:${t.source}:${t.id}:$i" }) { index, track ->
                    trackRow(vm, nav, popular, index, track, liked, canSuggest, currentKey)
                }
            }
            val albums = page.albumsBySource[selected].orEmpty()
            if (albums.isNotEmpty()) {
                item { SectionLabel("Альбомы и синглы · $label") }
                item {
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(albums, key = { "${it.source}:${it.id}" }) { album ->
                            MediaTile(
                                title = album.title,
                                subtitle = listOfNotNull(album.year?.toString(), albumKind(album.type)).joinToString(" · ").ifBlank { null },
                                cover = album.coverUrl,
                                size = 132.dp,
                                onClick = { nav.openRoute(Routes.album(album.source.name.lowercase(), album.id)) },
                            )
                        }
                    }
                }
            }
            val all = page.tracksBySource[selected].orEmpty()
            if (all.isNotEmpty()) {
                item { SectionLabel("Все треки · $label (${all.size})") }
                itemsIndexed(all, key = { i, t -> "all:${selected}:${t.id}:$i" }) { index, track ->
                    trackRow(vm, nav, all, index, track, liked, canSuggest, currentKey)
                }
            }
        }
        if (!page.loading && present.isEmpty() && page.name.isNotBlank()) {
            item {
                Text("На подключённых площадках исполнитель не найден", modifier = Modifier.padding(16.dp), color = scheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
fun AlbumScreen(vm: MssViewModel, nav: NavHostController) {
    val page by vm.albumPage.collectAsState()
    val liked by vm.likedIds.collectAsState()
    val player by vm.playerState.collectAsState()
    val canSuggest by vm.canSuggestToLobby.collectAsState()
    val currentKey = player.current?.let { "${it.source}:${it.id}" }
    val album = page.album
    val scheme = MaterialTheme.colorScheme
    var aboutOpen by rememberSaveable(album?.id) { mutableStateOf(false) }
    val tracks = album?.tracks.orEmpty()
    TrackList(
        tracks = tracks,
        liked = liked,
        onPlay = { list, i -> vm.play(list, i) },
        onLike = { vm.toggleLike(it) },
        onDownload = { vm.download(it) },
        onSimilar = { nav.openRoute(Routes.similar(it.source.name.lowercase(), it.id)) },
        onQueue = { vm.player.enqueue(it) },
        onWave = { vm.startWave(WaveSettings(seed = "track:${it.id}", seedTitle = it.title)) },
        onSuggest = if (canSuggest) ({ vm.suggestToLobby(it) }) else null,
        onQueueMany = { vm.enqueueMany(it) },
        onPublishMany = { vm.publishTracksToMss(it) },
        currentKey = currentKey,
        header = {
        item {
            Column(
                Modifier.fillMaxWidth().padding(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Cover(album?.coverUrl, Modifier.size(220.dp), corner = 14.dp)
                Text(
                    albumKind(album?.type) ?: "Альбом",
                    style = MaterialTheme.typography.labelMedium,
                    color = scheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
                Text(
                    album?.title ?: if (page.loading) "…" else "Альбом",
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                album?.let { a ->
                    val refs = a.artists.orEmpty()
                    if (refs.isNotEmpty()) {
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            refs.forEachIndexed { i, ref ->
                                Text(
                                    ref.name + if (i < refs.lastIndex) "," else "",
                                    style = MaterialTheme.typography.titleSmall,
                                    color = scheme.primary,
                                    modifier = Modifier.clickable {
                                        nav.openRoute(Routes.artist(ref.name, a.source.name.lowercase(), ref.id.ifBlank { "-" }))
                                    },
                                )
                            }
                        }
                    } else if (a.artist.isNotBlank()) {
                        Text(
                            a.artist,
                            style = MaterialTheme.typography.titleSmall,
                            color = scheme.primary,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.clickable { nav.openRoute(Routes.artist(a.artist, a.source.name.lowercase(), "-")) },
                        )
                    }
                    AlbumTags(a, Modifier.padding(top = 6.dp))
                    AlbumActions(vm, nav, a, Modifier.padding(top = 10.dp))
                }
            }
        }
        if (album != null && (page.platforms.size > 1 || page.platformsLoading)) {
            item {
                Column(Modifier.fillMaxWidth().padding(bottom = 4.dp)) {
                    Row(
                        Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text("Слушать на", style = MaterialTheme.typography.labelLarge, color = scheme.onSurfaceVariant)
                        if (page.platformsLoading) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                    }
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        items(page.platforms, key = { "alt:${it.source}" }) { alt ->
                            MssChip(
                                selected = alt.source == album.source,
                                label = sourceLabel(alt.source),
                                caption = when {
                                    page.switching == alt.source -> "загрузка…"
                                    alt.trackCount != null -> "${alt.trackCount} тр."
                                    else -> null
                                },
                            ) { vm.switchAlbumPlatform(alt.source) }
                        }
                    }
                }
            }
        }
        if (page.loading) {
            item {
                Row(Modifier.fillMaxWidth().padding(24.dp), horizontalArrangement = Arrangement.Center) {
                    CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.dp)
                }
            }
        }
        page.error?.let { message ->
            item { Text(message, modifier = Modifier.padding(16.dp), color = scheme.error) }
        }
        album?.description?.takeIf { it.isNotBlank() }?.let { text ->
            item {
                Column(Modifier.fillMaxWidth().clickable { aboutOpen = !aboutOpen }.padding(horizontal = 16.dp, vertical = 8.dp)) {
                    Text("Описание", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(
                        text,
                        modifier = Modifier.padding(top = 4.dp).animateContentSize(),
                        style = MaterialTheme.typography.bodyMedium,
                        color = scheme.onSurfaceVariant,
                        maxLines = if (aboutOpen) Int.MAX_VALUE else 4,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
        if (tracks.isNotEmpty()) {
            item { SectionLabel("Треки") }
        }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AlbumActions(vm: MssViewModel, nav: NavHostController, album: AlbumWithTracks, modifier: Modifier = Modifier) {
    val downloadedKeys by vm.downloadedKeys.collectAsState()
    val active by vm.activeDownloads.collectAsState()
    val savedAlbums by vm.downloadedAlbums.collectAsState()
    val likedAlbums by vm.likedAlbums.collectAsState()
    var confirm by remember { mutableStateOf(false) }
    var confirmCloud by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val scheme = MaterialTheme.colorScheme
    val isLiked = likedAlbums.any { it.source == album.source && it.id == album.id }
    val tracks = album.tracks.filter { canDownload(it) }
    val keys = tracks.map { DownloadScheduler.keyOf(it) }
    val done = keys.count { it in downloadedKeys }
    val running = keys.count { it in active }
    val saved = savedAlbums.any { it.source == album.source && it.id == album.id }
    val complete = tracks.isNotEmpty() && done == tracks.size
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        Button(onClick = { vm.play(album.tracks, 0) }, enabled = album.tracks.isNotEmpty()) {
            Icon(Icons.Default.PlayArrow, null, Modifier.size(18.dp))
            Text("Слушать", Modifier.padding(start = 4.dp))
        }
        IconButton({ vm.toggleAlbumLike(album) }) {
            Icon(
                if (isLiked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                contentDescription = if (isLiked) "Убрать из «Мне нравится»" else "Мне нравится",
                tint = if (isLiked) scheme.primary else scheme.onSurfaceVariant,
            )
        }
        IconButton({ menu = true }) {
            Icon(Icons.Default.MoreVert, "Ещё", tint = scheme.onSurfaceVariant)
        }
    }
    if (menu) {
        ModalBottomSheet(onDismissRequest = { menu = false }, sheetState = sheet) {
            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 8.dp)) {
                Text(
                    album.title,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                )
                HorizontalDivider(Modifier.padding(vertical = 4.dp), color = scheme.onSurface.copy(alpha = 0.08f))
                when {
                    tracks.isEmpty() -> {}
                    running > 0 -> AlbumMenuRow(
                        Icons.Filled.DownloadForOffline,
                        "Скачано $done из ${tracks.size}",
                        DownloadedGreen,
                    ) {}
                    complete && saved -> AlbumMenuRow(Icons.Filled.DownloadForOffline, "Удалить загрузку", scheme.error) {
                        menu = false
                        confirm = true
                    }
                    else -> AlbumMenuRow(
                        Icons.Outlined.DownloadForOffline,
                        if (done > 0) "Докачать (${tracks.size - done})" else "Скачать альбом",
                    ) {
                        menu = false
                        vm.downloadAlbum(album)
                    }
                }
                AlbumMenuRow(Icons.Outlined.CloudUpload, "Отправить на сервер MSS") {
                    menu = false
                    vm.publishAlbumToMss(album)
                }
                if (album.source == SourceId.LOCAL) {
                    AlbumMenuRow(Icons.Default.Delete, "Удалить альбом", scheme.error) {
                        menu = false
                        confirmCloud = true
                    }
                }
            }
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Удалить альбом с устройства?") },
            text = { Text("Все скачанные треки «${album.title}» будут удалены из «Скачанного», а альбом — из «Альбомов».") },
            confirmButton = {
                TextButton({ vm.removeAlbumDownload(album); confirm = false }) { Text("Удалить", color = scheme.error) }
            },
            dismissButton = { TextButton({ confirm = false }) { Text("Отмена") } },
        )
    }
    if (confirmCloud) {
        AlertDialog(
            onDismissRequest = { confirmCloud = false },
            title = { Text("Удалить альбом?") },
            text = { Text("«${album.title}» будет удалён из библиотеки. Треки останутся в «Мои файлы».") },
            confirmButton = {
                TextButton({
                    vm.deleteAlbum(album.id)
                    confirmCloud = false
                    nav.popBackStack()
                }) { Text("Удалить", color = scheme.error) }
            },
            dismissButton = { TextButton({ confirmCloud = false }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun AlbumMenuRow(
    icon: ImageVector,
    label: String,
    tint: Color = MaterialTheme.colorScheme.onSurface,
    onClick: () -> Unit,
) {
    val iconTint = if (tint == MaterialTheme.colorScheme.onSurface) MaterialTheme.colorScheme.onSurfaceVariant else tint
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(horizontal = 20.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Icon(icon, null, tint = iconTint, modifier = Modifier.size(22.dp))
        Text(label, color = tint, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AlbumTags(album: AlbumWithTracks, modifier: Modifier = Modifier) {
    val scheme = MaterialTheme.colorScheme
    val tags = buildList {
        add(albumKind(album.type) ?: "Альбом")
        album.year?.let { add(it.toString()) }
        album.genre?.split(',', '/')?.map { it.trim() }?.filter { it.isNotBlank() }?.take(3)?.forEach { add(it.replaceFirstChar(Char::uppercase)) }
        if (album.tracks.any { it.explicit == true }) add("18+")
        (album.trackCount ?: album.tracks.size.takeIf { it > 0 })?.let { add("$it треков") }
        (album.durationMs ?: album.tracks.sumOf { it.durationMs ?: 0 }).takeIf { it > 0 }?.let { add(formatLength(it)) }
        album.label?.takeIf { it.isNotBlank() }?.let { add("℗ $it") }
    }
    FlowRow(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(6.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        SourceTag(album.source, Modifier.align(Alignment.CenterVertically))
        tags.forEach { tag ->
            Text(
                tag,
                style = MaterialTheme.typography.labelMedium,
                color = scheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .clip(RoundedCornerShape(50))
                    .background(scheme.onSurface.copy(alpha = 0.07f))
                    .padding(horizontal = 10.dp, vertical = 4.dp),
            )
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
    )
}

@Composable
private fun trackRow(
    vm: MssViewModel,
    nav: NavHostController,
    list: List<UnifiedTrack>,
    index: Int,
    track: UnifiedTrack,
    liked: Set<String>,
    canSuggest: Boolean,
    currentKey: String?,
) {
    TrackRow(
        track,
        track.id in liked,
        onPlay = { vm.play(list, index) },
        onLike = { vm.toggleLike(track) },
        onDownload = { vm.download(track) },
        onSimilar = { nav.openRoute(Routes.similar(track.source.name.lowercase(), track.id)) },
        onQueue = { vm.player.enqueue(track) },
        onWave = { vm.startWave(WaveSettings(seed = "track:${track.id}", seedTitle = track.title)) },
        onSuggest = if (canSuggest) ({ vm.suggestToLobby(track) }) else null,
        active = currentKey == "${track.source}:${track.id}",
    )
}

@Composable
private fun PlatformCard(platform: ArtistPlatformUi, selected: Boolean, onClick: () -> Unit) {
    val scheme = MaterialTheme.colorScheme
    Column(
        Modifier
            .width(176.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (selected) scheme.primary.copy(alpha = 0.14f) else scheme.onSurface.copy(alpha = 0.06f))
            .clickable(onClick = onClick)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Cover(platform.imageUrl, Modifier.size(36.dp), corner = 18.dp)
            SourceTag(platform.source)
        }
        platform.monthlyListeners?.let {
            Text(formatCount(it), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            Text("слушателей в месяц", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
        }
        platform.followers?.let { n ->
            val word = if (platform.source == SourceId.YANDEX) "лайков" else "подписчиков"
            Text("${formatCount(n)} $word", style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
        }
        val counts = listOfNotNull(
            platform.trackCount.takeIf { it > 0 }?.let { "$it треков" },
            platform.albumCount.takeIf { it > 0 }?.let { "$it релизов" },
        )
        if (counts.isNotEmpty()) {
            Text(counts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = scheme.onSurfaceVariant)
        }
    }
}

private fun totalListeners(platforms: List<ArtistPlatformUi>): String? {
    val sum = platforms.mapNotNull { it.monthlyListeners?.toLong() }.takeIf { it.isNotEmpty() }?.sum() ?: return null
    return "${formatCount(sum.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())} слушателей в месяц"
}

private fun albumKind(type: String?): String? = when (type?.lowercase()) {
    "single" -> "Сингл"
    "ep" -> "EP"
    "compilation" -> "Сборник"
    else -> null
}

private fun formatLength(ms: Long): String {
    val minutes = ms / 60_000
    return if (minutes >= 60) "${minutes / 60} ч ${minutes % 60} мин" else "$minutes мин"
}

private fun formatCount(n: Int): String {
    val locale = Locale("ru")
    return when {
        n >= 1_000_000 -> String.format(locale, "%.1f млн", n / 1_000_000.0).replace(",0", "").replace(".0", "")
        n >= 1_000 -> String.format(locale, "%.1f тыс.", n / 1_000.0).replace(",0", "").replace(".0", "")
        else -> n.toString()
    }
}
