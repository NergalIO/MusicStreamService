package com.mss.core.network

import com.mss.core.model.PlayEvent
import com.mss.core.model.UnifiedTrack
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@Singleton
class PlayReporter @Inject constructor(
    private val api: MssApiClient,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val buffer = mutableListOf<PlayEvent>()
    private var flushing = false

    fun record(track: UnifiedTrack, playedSeconds: Double, finished: Boolean) {
        val durationSec = (track.durationMs ?: 0) / 1000.0
        val enough = playedSeconds >= 30 || (durationSec > 0 && playedSeconds >= durationSec / 2)
        if (!enough) return
        val event = PlayEvent(
            clientEventId = UUID.randomUUID().toString(),
            source = track.source,
            trackId = track.id.take(100),
            title = track.title.take(500).ifBlank { "Без названия" },
            artist = track.artist.take(500),
            artists = track.artists?.take(20),
            album = track.album?.take(500),
            albumId = track.albumId?.take(100),
            coverUrl = track.coverUrl?.takeIf { it.startsWith("http") || it.contains("/covers/") },
            durationMs = track.durationMs,
            playedMs = Math.round(playedSeconds * 1000),
            completed = finished,
            playedAt = java.time.Instant.now().toString(),
        )
        synchronized(buffer) { buffer += event }
        scope.launch {
            delay(15_000)
            flush()
        }
    }

    suspend fun flush() {
        if (flushing) return
        val batch: List<PlayEvent>
        synchronized(buffer) {
            if (buffer.isEmpty()) return
            batch = buffer.take(200)
            repeat(batch.size) { buffer.removeAt(0) }
        }
        flushing = true
        runCatching { api.postPlays(batch) }.onFailure {
            synchronized(buffer) { buffer.addAll(0, batch) }
        }
        flushing = false
    }
}
