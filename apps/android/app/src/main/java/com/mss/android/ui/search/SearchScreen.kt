package com.mss.android.ui.search

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import com.mss.android.ui.navigation.Routes
import com.mss.core.model.SourceId

@Composable
fun SearchScreen(vm: MssViewModel, nav: NavHostController) {
    var q by remember { mutableStateOf("") }
    var source by remember { mutableStateOf<SourceId?>(null) }
    var kind by remember { mutableStateOf("all") }
    val history by vm.searchHistory.collectAsState()
    val albums by vm.albums.collectAsState()
    val playlists by vm.searchPlaylists.collectAsState()
    val artists by vm.searchArtists.collectAsState()
    Column {
        OutlinedTextField(q, { q = it }, label = { Text("Поиск") }, modifier = Modifier.fillMaxWidth().padding(16.dp))
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            FilterChip(source == null, { source = null }, label = { Text("Все") })
            FilterChip(source == SourceId.LOCAL, { source = SourceId.LOCAL }, label = { Text("MSS") })
            FilterChip(source == SourceId.YANDEX, { source = SourceId.YANDEX }, label = { Text("Яндекс") })
            FilterChip(source == SourceId.SPOTIFY, { source = SourceId.SPOTIFY }, label = { Text("Spotify") })
            FilterChip(source == SourceId.VK, { source = SourceId.VK }, label = { Text("VK") })
        }
        Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("all" to "Все", "tracks" to "Треки", "artists" to "Артисты", "albums" to "Альбомы", "playlists" to "Плейлисты").forEach { (k, label) ->
                FilterChip(kind == k, { kind = k }, label = { Text(label) })
            }
        }
        Button(onClick = { vm.search(q, source, kind) }, modifier = Modifier.padding(16.dp)) { Text("Искать") }
        if (history.isNotEmpty()) {
            Text("Недавние", modifier = Modifier.padding(horizontal = 16.dp))
            history.take(5).forEach { h ->
                Text(h, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp).clickable { q = h; vm.search(h, source, kind) })
            }
        }
        albums.forEach { a ->
            Text("${a.title} · ${a.artist}", modifier = Modifier.fillMaxWidth().clickable {
                nav.navigate(Routes.album(a.source.name.lowercase(), a.id))
            }.padding(16.dp))
        }
        playlists.forEach { p ->
            Text(p.title, modifier = Modifier.fillMaxWidth().clickable {
                nav.navigate(if (p.source == SourceId.LOCAL) Routes.mssPlaylist(p.id) else Routes.playlist(p.source.name.lowercase(), p.id))
            }.padding(16.dp))
        }
        artists.forEach { a ->
            Text(a.name, modifier = Modifier.fillMaxWidth().clickable { nav.navigate(Routes.artist(a.name)) }.padding(16.dp))
        }
        CatalogList(vm, nav)
    }
}
