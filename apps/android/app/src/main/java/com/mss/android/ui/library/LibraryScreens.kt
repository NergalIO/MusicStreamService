package com.mss.android.ui.library

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
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
import com.mss.android.ui.components.Cover
import com.mss.android.ui.navigation.Routes
import com.mss.core.model.SourceId

@Composable
fun LibraryHub(nav: NavHostController) {
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button({ nav.navigate(Routes.LIKES) }, Modifier.fillMaxWidth()) { Text("Понравилось") }
        Button({ nav.navigate(Routes.PLAYLISTS) }, Modifier.fillMaxWidth()) { Text("Плейлисты") }
        Button({ nav.navigate(Routes.ARTISTS) }, Modifier.fillMaxWidth()) { Text("Исполнители") }
        Button({ nav.navigate(Routes.UPLOADS) }, Modifier.fillMaxWidth()) { Text("Загрузки") }
        Button({ nav.navigate(Routes.DOWNLOADS) }, Modifier.fillMaxWidth()) { Text("Скачанное") }
        Button({ nav.navigate(Routes.OFFLINE) }, Modifier.fillMaxWidth()) { Text("Офлайн") }
        Button({ nav.navigate(Routes.HISTORY) }, Modifier.fillMaxWidth()) { Text("История") }
    }
}

@Composable
fun PlaylistHub(vm: MssViewModel, nav: NavHostController) {
    val playlists by vm.playlists.collectAsState()
    var name by remember { mutableStateOf("") }
    Column {
        Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(name, { name = it }, label = { Text("Новый плейлист") }, modifier = Modifier.weight(1f))
            Button(onClick = { vm.createPlaylist(name); name = "" }) { Text("Создать") }
        }
        LazyColumn {
            items(playlists) { p ->
                Row(Modifier.fillMaxWidth().clickable {
                    nav.navigate(if (p.source == SourceId.LOCAL) Routes.mssPlaylist(p.id) else Routes.playlist(p.source.name.lowercase(), p.id))
                }.padding(16.dp)) {
                    Cover(p.coverUrl)
                    Column(Modifier.padding(start = 12.dp).weight(1f)) {
                        Text(p.title)
                        Text("${p.trackCount ?: 0} треков", style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
                    }
                    if (p.source == SourceId.LOCAL) {
                        TextButton({ vm.deletePlaylist(p.id) }) { Text("Удалить") }
                    }
                }
            }
        }
    }
}

@Composable
fun ArtistHub(vm: MssViewModel, nav: NavHostController) {
    val artists by vm.artists.collectAsState()
    LazyColumn {
        items(artists) { a ->
            Text(a.name, modifier = Modifier.fillMaxWidth().clickable { nav.navigate(Routes.artist(a.name)) }.padding(16.dp))
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
    Column {
        need?.let {
            Text("Нужен файл для relay: ${it.title ?: it.trackId}", modifier = Modifier.padding(16.dp))
        }
        Button({ launcher.launch(arrayOf("audio/*")) }, Modifier.padding(16.dp)) { Text("Выбрать файлы") }
        CatalogList(vm, nav)
    }
}

@Composable
fun DownloadsScreen(vm: MssViewModel) {
    val recs by vm.downloadRecords.collectAsState()
    LazyColumn {
        items(recs) { r ->
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(r.track.title)
                    Text(r.path, style = androidx.compose.material3.MaterialTheme.typography.bodySmall, maxLines = 1)
                }
                TextButton({ vm.removeDownload(r.key) }) { Text("Удалить") }
            }
        }
    }
}
