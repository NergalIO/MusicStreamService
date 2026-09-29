package com.mss.android.ui.catalog

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.navigation.NavHostController
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.TrackList
import com.mss.android.ui.navigation.Routes
import com.mss.core.model.WaveSettings

@Composable
fun CatalogList(vm: MssViewModel, nav: NavHostController) {
    val tracks by vm.tracks.collectAsState()
    val liked by vm.likedIds.collectAsState()
    val title by vm.detailTitle.collectAsState()
    Column {
        if (title.isNotBlank()) Text(title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(16.dp))
        TrackList(
            tracks, liked,
            onPlay = { list, i -> vm.play(list, i) },
            onLike = { vm.toggleLike(it) },
            onDownload = { vm.download(it) },
            onSimilar = { nav.navigate(Routes.similar(it.source.name.lowercase(), it.id)) },
            onQueue = { vm.player.enqueue(it) },
            onWave = { vm.startWave(WaveSettings(seed = "track:${it.id}", seedTitle = it.title)) },
            onSuggest = { vm.suggestToLobby(it) },
        )
    }
}
