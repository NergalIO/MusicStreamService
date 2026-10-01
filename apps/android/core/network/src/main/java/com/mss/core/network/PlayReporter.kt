package com.mss.core.network

import android.annotation.SuppressLint
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import com.mss.core.model.PlayEvent
import com.mss.core.model.UnifiedTrack
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

/**
 * Очередь прослушиваний на диске: событие не пропадает, если приложение закрыли до отправки.
 * Сервер склеивает события телефона и компьютера в одну историю и статистику.
 */
@Singleton
class PlayReporter @Inject constructor(
    private val api: MssApiClient,
    @ApplicationContext context: Context,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val json = Json { ignoreUnknownKeys = true }
    private val file = File(context.filesDir, "play-buffer.json")
    private val mutex = Mutex()
    private val flushing = AtomicBoolean(false)
    private val scheduled = AtomicBoolean(false)
    private val _synced = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val synced: SharedFlow<Unit> = _synced.asSharedFlow()
    private val _online = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val online: SharedFlow<Unit> = _online.asSharedFlow()

    init {
        scheduleFlush(3_000)
        watchNetwork(context)
    }

    @SuppressLint("MissingPermission")
    private fun watchNetwork(context: Context) {
        val manager = context.getSystemService(ConnectivityManager::class.java) ?: return
        runCatching {
            manager.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    _online.tryEmit(Unit)
                    scope.launch { flush() }
                }
            })
        }
    }

    fun record(track: UnifiedTrack, playedSeconds: Double, finished: Boolean) {
        val durationSec = (track.durationMs ?: 0) / 1000.0
        val enough = playedSeconds >= 30 || (durationSec > 0 && playedSeconds >= durationSec / 2)
        if (!enough) return
        val cover = track.coverUrl
        val event = PlayEvent(
            clientEventId = UUID.randomUUID().toString(),
            source = track.source,
            trackId = track.id.take(100),
            title = track.title.take(500).ifBlank { "Без названия" },
            artist = track.artist.take(500),
            artists = track.artists?.take(20),
            album = track.album?.take(500),
            albumId = track.albumId?.take(100),
            coverUrl = cover?.takeIf {
                it.startsWith("http://") || it.startsWith("https://") || it.startsWith("/api/") || it.contains("/covers/")
            },
            durationMs = track.durationMs,
            playedMs = Math.round(playedSeconds * 1000),
            completed = finished,
            playedAt = java.time.Instant.now().toString(),
        )
        scope.launch {
            mutex.withLock {
                write(read() + event)
            }
            scheduleFlush(15_000)
        }
    }

    suspend fun flush() {
        if (!flushing.compareAndSet(false, true)) return
        var failed = false
        var sentAny = false
        try {
            while (true) {
                val batch = mutex.withLock { read().take(BATCH) }
                if (batch.isEmpty()) break
                val posted = runCatching { api.postPlays(batch) }
                if (posted.isFailure) {
                    failed = true
                    break
                }
                sentAny = true
                val sentIds = batch.map { it.clientEventId }.toSet()
                mutex.withLock { write(read().filter { it.clientEventId !in sentIds }.takeLast(MAX_BUFFER)) }
            }
        } finally {
            flushing.set(false)
        }
        val pending = mutex.withLock { read().isNotEmpty() }
        when {
            failed -> scheduleFlush(60_000)
            pending -> flush()
            sentAny -> _synced.tryEmit(Unit)
        }
    }

    private fun scheduleFlush(delayMs: Long) {
        if (!scheduled.compareAndSet(false, true)) return
        scope.launch {
            delay(delayMs)
            scheduled.set(false)
            flush()
        }
    }

    private fun read(): List<PlayEvent> {
        if (!file.exists()) return emptyList()
        return runCatching { json.decodeFromString<List<PlayEvent>>(file.readText()) }.getOrDefault(emptyList())
    }

    private fun write(events: List<PlayEvent>) {
        val trimmed = events.takeLast(MAX_BUFFER)
        if (trimmed.isEmpty()) {
            file.delete()
            return
        }
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.writeText(json.encodeToString(trimmed))
        if (!tmp.renameTo(file)) {
            file.writeText(tmp.readText())
            tmp.delete()
        }
    }

    private companion object {
        const val MAX_BUFFER = 5000
        const val BATCH = 200
    }
}
