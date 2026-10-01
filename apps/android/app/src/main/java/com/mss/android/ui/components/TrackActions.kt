package com.mss.android.ui.components

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.PlaylistAdd
import androidx.compose.material.icons.automirrored.filled.QueueMusic
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Album
import androidx.compose.material.icons.filled.AutoAwesome
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DownloadForOffline
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Radio
import androidx.compose.material.icons.filled.Send
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.outlined.DownloadForOffline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.navigation.Routes
import com.mss.android.ui.navigation.openRoute
import com.mss.core.downloads.DownloadScheduler
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.WaveSettings

/** Зелёный Spotify для скачанных треков. */
val DownloadedGreen = Color(0xFF1DB954)

class TrackHost(val vm: MssViewModel, val nav: NavHostController)

val LocalTrackHost = staticCompositionLocalOf<TrackHost?> { null }

fun canDownload(track: UnifiedTrack): Boolean = track.playable

fun mssTrackUrl(track: UnifiedTrack): String =
    "mss://track/${track.source.name.lowercase()}/${java.net.URLEncoder.encode(track.id, Charsets.UTF_8)}"

private data class ArtistLink(val name: String, val id: String?)

private fun artistLinks(track: UnifiedTrack): List<ArtistLink> {
    val refs = track.artists.orEmpty().filter { it.name.isNotBlank() }
    if (refs.isNotEmpty()) return refs.map { ArtistLink(it.name, it.id.ifBlank { null }) }
    return track.artist.split(", ").filter { it.isNotBlank() }.map { ArtistLink(it, null) }
}

/** Кнопка скачивания в строке трека: контур — не скачан, зелёная — скачан, кольцо — качается. */
@Composable
fun DownloadButton(track: UnifiedTrack, modifier: Modifier = Modifier) {
    val host = LocalTrackHost.current ?: return
    if (!canDownload(track)) return
    val downloaded by host.vm.downloadedKeys.collectAsState()
    val active by host.vm.activeDownloads.collectAsState()
    val key = DownloadScheduler.keyOf(track)
    var confirm by remember { mutableStateOf(false) }
    val scheme = MaterialTheme.colorScheme
    when {
        key in active -> IconButton({}, modifier.size(40.dp), enabled = false) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = DownloadedGreen)
        }
        key in downloaded -> IconButton({ confirm = true }, modifier.size(40.dp)) {
            Icon(Icons.Filled.DownloadForOffline, "Скачано", tint = DownloadedGreen)
        }
        else -> IconButton({ host.vm.download(track) }, modifier.size(40.dp)) {
            Icon(Icons.Outlined.DownloadForOffline, "Скачать", tint = scheme.onSurfaceVariant)
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text("Удалить загрузку?") },
            text = { Text("«${track.title}» будет удалён с устройства и станет доступен только онлайн.") },
            confirmButton = {
                TextButton({ host.vm.removeDownload(track); confirm = false }) { Text("Удалить", color = scheme.error) }
            },
            dismissButton = { TextButton({ confirm = false }) { Text("Отмена") } },
        )
    }
}

private class SheetItem(val icon: ImageVector, val label: String, val danger: Boolean = false, val action: () -> Unit)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrackActionsSheet(track: UnifiedTrack, onDismiss: () -> Unit, extra: List<Pair<String, () -> Unit>> = emptyList()) {
    val host = LocalTrackHost.current ?: return
    val vm = host.vm
    val nav = host.nav
    val context = LocalContext.current
    val clipboard = LocalClipboardManager.current
    val liked by vm.likedIds.collectAsState()
    val canSuggest by vm.canSuggestToLobby.collectAsState()
    val downloaded by vm.downloadedKeys.collectAsState()
    val active by vm.activeDownloads.collectAsState()
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var picker by remember { mutableStateOf(false) }
    val key = DownloadScheduler.keyOf(track)
    val isLiked = track.id in liked
    fun toast(text: String) = Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
    fun run(block: () -> Unit): () -> Unit = { onDismiss(); block() }

    val groups = buildList {
        add(buildList {
            if (canSuggest) add(SheetItem(Icons.Default.Send, "Предложить DJ", action = run { vm.suggestToLobby(track) }))
            add(SheetItem(Icons.Default.SkipNext, "Играть следующим", action = run { vm.playNext(track); toast("Сыграет следующим") }))
            add(SheetItem(Icons.AutoMirrored.Filled.QueueMusic, "Добавить в очередь", action = run { vm.player.enqueue(track); toast("Добавлено в очередь") }))
            add(SheetItem(Icons.AutoMirrored.Filled.PlaylistAdd, "Добавить в плейлист", action = { picker = true }))
        })
        add(buildList {
            add(
                SheetItem(
                    if (isLiked) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                    if (isLiked) "Удалить из «Мне нравится»" else "Мне нравится",
                    action = run { vm.toggleLike(track) },
                ),
            )
            if (track.source == SourceId.YANDEX) {
                add(SheetItem(Icons.Default.ThumbDown, "Не рекомендовать", action = run { vm.dislike(track) }))
            }
        })
        add(buildList {
            artistLinks(track).take(3).forEach { a ->
                add(
                    SheetItem(Icons.Default.Mic, "Исполнитель: ${a.name}", action = run {
                        nav.openRoute(Routes.artist(a.name, track.source.name.lowercase(), a.id ?: "-"))
                    }),
                )
            }
            if (!track.album.isNullOrBlank() || !track.albumId.isNullOrBlank()) {
                add(SheetItem(Icons.Default.Album, "Перейти к альбому", action = run { nav.openRoute(Routes.album(track)) }))
            }
            when (track.source) {
                SourceId.YANDEX -> add(
                    SheetItem(Icons.Default.Radio, "Волна по треку", action = run {
                        vm.startWave(WaveSettings(seed = "track:${track.id}", seedTitle = track.title))
                    }),
                )
                SourceId.SPOTIFY -> add(SheetItem(Icons.Default.Radio, "Радио по треку", action = run { vm.startSpotifyRadio(track) }))
                else -> {}
            }
            add(
                SheetItem(Icons.Default.AutoAwesome, "Похожие треки", action = run {
                    nav.openRoute(Routes.similar(track.source.name.lowercase(), track.id))
                }),
            )
        })
        add(buildList {
            when {
                key in downloaded -> add(SheetItem(Icons.Default.Delete, "Удалить загрузку", action = run { vm.removeDownload(track) }))
                key in active -> add(SheetItem(Icons.Filled.DownloadForOffline, "Скачивается…", action = {}))
                canDownload(track) -> add(
                    SheetItem(Icons.Outlined.DownloadForOffline, if (track.source == SourceId.LOCAL) "Скачать офлайн" else "Скачать", action = run { vm.download(track) }),
                )
            }
            add(
                SheetItem(Icons.Default.ContentCopy, "Скопировать название", action = run {
                    clipboard.setText(AnnotatedString("${track.artist} — ${track.title}"))
                    toast("Название скопировано")
                }),
            )
            add(
                SheetItem(Icons.Default.Link, "Скопировать ссылку MSS", action = run {
                    clipboard.setText(AnnotatedString(mssTrackUrl(track)))
                    toast("Ссылка скопирована")
                }),
            )
            add(
                SheetItem(Icons.Default.Share, "Поделиться", action = run {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_TEXT, "${track.artist} — ${track.title}\n${mssTrackUrl(track)}")
                    }
                    context.startActivity(Intent.createChooser(send, "Поделиться треком"))
                }),
            )
            extra.forEach { (label, action) -> add(SheetItem(Icons.Default.Delete, label, danger = true, action = run(action))) }
        })
    }.filter { it.isNotEmpty() }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 8.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                Cover(track.coverUrl, Modifier.size(52.dp))
                Column(Modifier.weight(1f)) {
                    Text(track.title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            track.artist,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        SourceTag(track.source)
                    }
                }
            }
            groups.forEach { group ->
                HorizontalDivider(Modifier.padding(vertical = 4.dp), color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.08f))
                group.forEach { item -> SheetRow(item) }
            }
        }
    }
    if (picker) PlaylistPickerDialog(track) { picker = false; onDismiss() }
}

@Composable
private fun SheetRow(item: SheetItem) {
    val color = if (item.danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    Row(
        Modifier.fillMaxWidth().clickable(onClick = item.action).padding(horizontal = 20.dp, vertical = 13.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        Icon(item.icon, null, tint = if (item.danger) color else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
        Text(item.label, color = color, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun PlaylistPickerDialog(track: UnifiedTrack, onDone: () -> Unit) {
    val host = LocalTrackHost.current ?: return
    val vm = host.vm
    val playlists by vm.pickerPlaylists.collectAsState()
    var creating by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    LaunchedEffect(Unit) { vm.loadPickerPlaylists() }
    AlertDialog(
        onDismissRequest = onDone,
        title = { Text("Добавить в плейлист") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (creating) {
                    MssField(name, { name = it }, placeholder = "Название нового плейлиста", modifier = Modifier.fillMaxWidth())
                } else {
                    Row(
                        Modifier.fillMaxWidth().clickable { creating = true }.padding(vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(Icons.Default.Add, null, tint = MaterialTheme.colorScheme.primary)
                        Text("Новый плейлист", color = MaterialTheme.colorScheme.primary)
                    }
                    LazyColumn(Modifier.fillMaxWidth().padding(top = 4.dp)) {
                        items(playlists, key = { it.id }) { p ->
                            Row(
                                Modifier.fillMaxWidth().clickable { vm.addToPlaylist(p, track); onDone() }.padding(vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                Cover(p.coverUrl, Modifier.size(40.dp), corner = 6.dp)
                                Column(Modifier.weight(1f)) {
                                    Text(p.title, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    p.trackCount?.let {
                                        Text("$it треков", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (creating) {
                TextButton({ vm.createPlaylistWith(name, track); onDone() }, enabled = name.isNotBlank()) { Text("Создать и добавить") }
            }
        },
        dismissButton = { TextButton({ if (creating) creating = false else onDone() }) { Text(if (creating) "Назад" else "Отмена") } },
    )
}
