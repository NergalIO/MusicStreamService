package com.mss.android.ui.player

import android.media.audiofx.Visualizer
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.mss.android.ui.MssViewModel
import com.mss.android.ui.components.Cover
import com.mss.core.model.LobbyDto

@Composable
fun LobbyBar(lobby: LobbyDto?, onOpen: () -> Unit) {
    if (lobby == null) return
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text("Лобби: ${lobby.title}", style = MaterialTheme.typography.bodySmall)
        Text(lobby.inviteCode, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun MiniPlayer(vm: MssViewModel, onOpen: () -> Unit) {
    val state by vm.playerState.collectAsState()
    val track = state.current ?: return
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Cover(track.coverUrl, Modifier.height(40.dp))
        Column(Modifier.weight(1f)) {
            Text(track.title, maxLines = 1)
            Text(track.artist, style = MaterialTheme.typography.bodySmall, maxLines = 1)
        }
        IconButton({ vm.player.toggle() }) { Text(if (state.playing) "⏸" else "▶") }
        IconButton({ vm.player.next() }) { Icon(Icons.Default.SkipNext, null) }
    }
}

@Composable
fun NowPlayingScreen(vm: MssViewModel) {
    val state by vm.playerState.collectAsState()
    val lyrics by vm.lyrics.collectAsState()
    val settings by vm.playbackSettings.collectAsState()
    val track = state.current ?: return
    var tab by remember { mutableIntStateOf(0) }
    LaunchedEffect(track.id) { vm.loadLyrics(track) }
    Column(Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Cover(track.coverUrl, Modifier.height(240.dp).fillMaxWidth())
        Text(track.title, style = MaterialTheme.typography.headlineSmall, modifier = Modifier.padding(top = 16.dp))
        Text(track.artist)
        if (settings.visualizer) SessionVisualizer(vm.player.audioSessionId())
        Slider(
            value = state.positionMs.toFloat().coerceAtMost(state.durationMs.toFloat().coerceAtLeast(1f)),
            onValueChange = { vm.player.seekTo(it.toLong()) },
            valueRange = 0f..(state.durationMs.toFloat().coerceAtLeast(1f)),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ vm.player.prev() }) { Icon(Icons.Default.SkipPrevious, null) }
            Button({ vm.player.toggle() }) { Text(if (state.playing) "Пауза" else "Играть") }
            IconButton({ vm.player.next() }) { Icon(Icons.Default.SkipNext, null) }
        }
        val progress = if (state.durationMs == 0L) 0f else state.positionMs / state.durationMs.toFloat()
        LinearProgressIndicator({ progress }, modifier = Modifier.fillMaxWidth())
        Row {
            TextButton({ tab = 0 }) { Text("Очередь") }
            TextButton({ tab = 1 }) { Text("Тексты") }
            TextButton({
                tab = 2
                vm.loadSimilar(track)
            }) { Text("Похожие") }
        }
        if (tab == 0) {
            LazyColumn {
                items(state.queue.size) { i ->
                    val t = state.queue[i]
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            t.title,
                            modifier = Modifier.weight(1f).clickable { vm.play(state.queue, i) }.padding(8.dp),
                        )
                        TextButton({ if (i > 0) vm.player.move(i, i - 1) }) { Text("↑") }
                        TextButton({ if (i < state.queue.lastIndex) vm.player.move(i, i + 1) }) { Text("↓") }
                    }
                }
            }
        } else if (tab == 1) {
            LazyColumn {
                items(lyrics?.lines.orEmpty()) { line ->
                    val active = lyrics?.synced == true && state.positionMs >= line.timeMs
                    Text(line.text, color = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                }
            }
        } else {
            val similar by vm.tracks.collectAsState()
            LazyColumn {
                items(similar) { t ->
                    Text(t.title, modifier = Modifier.fillMaxWidth().clickable { vm.play(similar, similar.indexOf(t)) }.padding(8.dp))
                }
            }
        }
    }
}

@Composable
private fun SessionVisualizer(sessionId: Int) {
    var level by remember { mutableFloatStateOf(0f) }
    DisposableEffect(sessionId) {
        val vis = runCatching {
            Visualizer(sessionId).apply {
                captureSize = Visualizer.getCaptureSizeRange()[0]
                setDataCaptureListener(
                    object : Visualizer.OnDataCaptureListener {
                        override fun onWaveFormDataCapture(visualizer: Visualizer?, waveform: ByteArray?, samplingRate: Int) {
                            if (waveform == null) return
                            val avg = waveform.map { kotlin.math.abs(it.toInt()) }.average()
                            level = (avg / 128.0).toFloat().coerceIn(0f, 1f)
                        }
                        override fun onFftDataCapture(visualizer: Visualizer?, fft: ByteArray?, samplingRate: Int) = Unit
                    },
                    Visualizer.getMaxCaptureRate() / 2,
                    true,
                    false,
                )
                enabled = true
            }
        }.getOrNull()
        onDispose { vis?.release() }
    }
    LinearProgressIndicator({ level }, modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp))
}
