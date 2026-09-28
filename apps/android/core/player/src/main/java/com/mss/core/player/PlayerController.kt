package com.mss.core.player

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.mss.core.connectors.PlaybackResolver
import com.mss.core.model.UnifiedTrack
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class PlayerUiState(
    val current: UnifiedTrack? = null,
    val queue: List<UnifiedTrack> = emptyList(),
    val playing: Boolean = false,
    val positionMs: Long = 0,
    val durationMs: Long = 0,
    val shuffle: Boolean = false,
    val repeat: RepeatMode = RepeatMode.OFF,
    val radio: Boolean = false,
    val sleepEndsAt: Long? = null,
)

enum class RepeatMode { OFF, ALL, ONE }

@Singleton
class PlayerController @Inject constructor(
    @ApplicationContext private val context: Context,
    private val resolver: PlaybackResolver,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val exo = ExoPlayer.Builder(context).build()
    private val _state = MutableStateFlow(PlayerUiState())
    val state: StateFlow<PlayerUiState> = _state.asStateFlow()

    private var queue: MutableList<UnifiedTrack> = mutableListOf()
    private var index = 0

    init {
        exo.addListener(
            object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) {
                    _state.value = _state.value.copy(playing = isPlaying)
                }

                override fun onPlaybackStateChanged(playbackState: Int) {
                    if (playbackState == Player.STATE_ENDED) next()
                }
            },
        )
    }

    fun exoPlayer(): ExoPlayer = exo

    fun playTracks(tracks: List<UnifiedTrack>, startIndex: Int = 0, radio: Boolean = false) {
        queue = tracks.toMutableList()
        index = startIndex.coerceIn(0, (queue.size - 1).coerceAtLeast(0))
        _state.value = _state.value.copy(queue = queue.toList(), radio = radio)
        playCurrent()
    }

    fun playUrl(track: UnifiedTrack, url: String) {
        ensurePlaybackService()
        exo.setMediaItem(MediaItem.fromUri(url))
        exo.prepare()
        exo.play()
        _state.value = _state.value.copy(current = track, playing = true)
    }

    fun toggle() {
        if (exo.isPlaying) exo.pause() else exo.play()
    }

    fun next() {
        if (queue.isEmpty()) return
        val mode = _state.value.repeat
        index = when (mode) {
            RepeatMode.ONE -> index
            RepeatMode.ALL -> (index + 1) % queue.size
            RepeatMode.OFF -> if (index + 1 < queue.size) index + 1 else return
        }
        playCurrent()
    }

    fun prev() {
        if (queue.isEmpty()) return
        index = if (index > 0) index - 1 else 0
        playCurrent()
    }

    fun seekTo(ms: Long) {
        exo.seekTo(ms)
    }

    fun setShuffle(enabled: Boolean) {
        _state.value = _state.value.copy(shuffle = enabled)
    }

    fun cycleRepeat() {
        val next = when (_state.value.repeat) {
            RepeatMode.OFF -> RepeatMode.ALL
            RepeatMode.ALL -> RepeatMode.ONE
            RepeatMode.ONE -> RepeatMode.OFF
        }
        _state.value = _state.value.copy(repeat = next)
    }

    fun setSleepTimer(minutes: Int?) {
        _state.value = _state.value.copy(
            sleepEndsAt = minutes?.let { System.currentTimeMillis() + it * 60_000L },
        )
    }

    fun tickProgress() {
        _state.value = _state.value.copy(
            positionMs = exo.currentPosition,
            durationMs = exo.duration.coerceAtLeast(0),
        )
        val ends = _state.value.sleepEndsAt
        if (ends != null && System.currentTimeMillis() >= ends) {
            exo.pause()
            _state.value = _state.value.copy(sleepEndsAt = null, playing = false)
        }
    }

    private fun playCurrent() {
        val track = queue.getOrNull(index) ?: return
        _state.value = _state.value.copy(current = track, queue = queue.toList())
        scope.launch {
            runCatching {
                val url = resolver.resolveUrl(track)
                playUrl(track, url)
            }
        }
    }

    private fun ensurePlaybackService() {
        val intent = Intent(context, PlaybackService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent)
        } else {
            context.startService(intent)
        }
    }

    fun pendingTrack(): UnifiedTrack? = _state.value.current
}
