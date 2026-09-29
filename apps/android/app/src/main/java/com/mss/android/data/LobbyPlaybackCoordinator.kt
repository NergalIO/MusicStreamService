package com.mss.android.data

import com.mss.core.datastore.MssPreferences
import com.mss.core.lobby.LobbyClient
import com.mss.core.player.PlayerController
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Singleton
class LobbyPlaybackCoordinator @Inject constructor(
    private val lobby: LobbyClient,
    private val player: PlayerController,
    private val prefs: MssPreferences,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var applyingRemote = false
    private var publishJob: Job? = null
    private var lastRemoteKey: String? = null

    init {
        scope.launch {
            lobby.lobby.collect { room ->
                val userId = prefs.loadSession()?.user?.id ?: return@collect
                if (room == null || room.hostUserId == userId) return@collect
                val remote = room.playback
                val track = remote.track ?: return@collect
                val key = "${track.source}:${track.id}:${remote.paused}:${remote.updatedAt}"
                if (key == lastRemoteKey) return@collect
                lastRemoteKey = key
                applyingRemote = true
                try {
                    val current = player.state.value.current
                    val same = current?.source == track.source && current.id == track.id
                    if (!same) player.playTracks(listOf(track), 0)
                    val updated = remote.updatedAt?.let { runCatching { java.time.Instant.parse(it).toEpochMilli() }.getOrNull() }
                    var pos = remote.positionMs
                    if (!remote.paused && updated != null) {
                        pos += (System.currentTimeMillis() - updated).coerceAtLeast(0)
                    }
                    if (kotlin.math.abs(player.state.value.positionMs - pos) > 1500) player.seekTo(pos)
                    if (remote.paused) player.pause() else player.resume()
                } finally {
                    applyingRemote = false
                }
            }
        }
        scope.launch {
            player.state.collect { playback ->
                if (applyingRemote) return@collect
                val room = lobby.lobby.value ?: return@collect
                val userId = prefs.loadSession()?.user?.id ?: return@collect
                if (room.hostUserId != userId) return@collect
                val track = playback.current ?: return@collect
                publishJob?.cancel()
                publishJob = scope.launch {
                    delay(800)
                    val action = if (playback.playing) "play" else "pause"
                    runCatching { lobby.publishPlayback(action, track, playback.positionMs) }
                }
            }
        }
    }
}
