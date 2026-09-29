package com.mss.android.ui.library

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.LibraryMusic
import androidx.compose.material.icons.filled.OfflinePin
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material3.Button
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.catalog.CatalogList
import com.mss.android.ui.components.EmptyState
import com.mss.android.ui.components.EntityRow
import com.mss.android.ui.components.HubRow
import com.mss.android.ui.components.MssField
import com.mss.android.ui.components.ScreenTitle
import com.mss.android.ui.navigation.Routes
import com.mss.core.model.SourceId

@Composable
fun LibraryHub(nav: NavHostController) {
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(vertical = 8.dp)) {
        ScreenTitle("Медиатека")
        HubRow("Понравилось", "Лайки со всех источников", Icons.Default.Favorite) { nav.navigate(Routes.LIKES) }
        HubRow("Плейлисты", "Свои и из сервисов", Icons.Default.LibraryMusic) { nav.navigate(Routes.PLAYLISTS) }
        HubRow("Исполнители", "Любимые артисты", Icons.Default.Person) { nav.navigate(Routes.ARTISTS) }
        HubRow("Загрузки", "Ваши файлы", Icons.Default.UploadFile) { nav.navigate(Routes.UPLOADS) }
        HubRow("Скачанное", "Для офлайна", Icons.Default.CloudDownload) { nav.navigate(Routes.DOWNLOADS) }
        HubRow("Офлайн", "Пакеты .mss", Icons.Default.OfflinePin) { nav.navigate(Routes.OFFLINE) }
        HubRow("История", "Недавно играли", Icons.Default.History) { nav.navigate(Routes.HISTORY) }
    }
}

@Composable
fun PlaylistHub(vm: MssViewModel, nav: NavHostController) {
    val playlists by vm.playlists.collectAsState()
    var name by remember { mutableStateOf("") }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            MssField(name, { name = it }, placeholder = "Название", label = "Новый плейлист", modifier = Modifier.fillMaxWidth())
            Button(onClick = { vm.createPlaylist(name); name = "" }, enabled = name.isNotBlank(), modifier = Modifier.fillMaxWidth()) { Text("Создать") }
        }
        if (playlists.isEmpty()) {
            EmptyState("Пока нет плейлистов", "Создайте свой или подключите источник в «Ещё».")
        } else {
            LazyColumn(Modifier.weight(1f).fillMaxWidth()) {
                items(playlists) { p ->
                    EntityRow(
                        title = p.title,
                        subtitle = "${p.trackCount ?: 0} треков",
                        cover = p.coverUrl,
                        onClick = {
                            nav.navigate(
                                if (p.source == SourceId.LOCAL) Routes.mssPlaylist(p.id)
                                else Routes.playlist(p.source.name.lowercase(), p.id),
                            )
                        },
                        trailing = {
                            if (p.source == SourceId.LOCAL) {
                                TextButton({ vm.deletePlaylist(p.id) }) {
                                    Text("Удалить", color = MaterialTheme.colorScheme.error)
                                }
                            }
                        },
                    )
                }
            }
        }
    }
}

@Composable
fun ArtistHub(vm: MssViewModel, nav: NavHostController) {
    val artists by vm.artists.collectAsState()
    if (artists.isEmpty()) {
        EmptyState("Нет исполнителей", "Лайкните треки — артисты появятся здесь.")
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(artists) { a ->
            EntityRow(a.name, "${a.trackCount} треков", null, { nav.navigate(Routes.artist(a.name)) })
        }
    }
}

@Composable
fun UploadsScreen(vm: MssViewModel, nav: NavHostController) {
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
        uris.forEach { uri ->
            val name = uri.lastPathSegment ?: "track"
            vm.registerUpload(uri, name, "Unknown")
        }
        vm.clearNeedFile()
    }
    val need by vm.needFile.collectAsState()
    LaunchedEffect(Unit) { vm.loadUploads() }
    Column(Modifier.fillMaxSize()) {
        need?.let {
            Text("Нужен файл для relay: ${it.title ?: it.trackId}", modifier = Modifier.padding(16.dp))
        }
        Button({ launcher.launch(arrayOf("audio/*")) }, Modifier.padding(16.dp)) { Text("Выбрать файлы") }
        CatalogList(vm, nav, Modifier.weight(1f))
    }
}

@Composable
fun DownloadsScreen(vm: MssViewModel) {
    val recs by vm.downloadRecords.collectAsState()
    if (recs.isEmpty()) {
        EmptyState("Ничего не скачано", "Скачайте трек из меню «⋯» — он появится здесь.")
        return
    }
    LazyColumn(Modifier.fillMaxSize()) {
        items(recs) { r ->
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f).padding(end = 8.dp)) {
                    Text(r.track.title, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                    Text(r.path, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                TextButton({ vm.removeDownload(r.key) }) { Text("Удалить") }
            }
        }
    }
}
