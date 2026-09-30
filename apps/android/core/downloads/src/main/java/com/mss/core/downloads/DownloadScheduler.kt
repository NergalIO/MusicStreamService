package com.mss.core.downloads

import android.content.Context
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.mss.core.connectors.YandexConnector
import com.mss.core.datastore.MssPreferences
import com.mss.core.model.AlbumWithTracks
import com.mss.core.model.DownloadRecord
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedTrack
import com.mss.core.network.MssApiClient
import com.mss.core.offline.OfflineStore
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.time.Instant
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Singleton
class DownloadScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: MssApiClient,
    private val preferences: MssPreferences,
    private val offline: OfflineStore,
    private val yandex: YandexConnector,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val indexFile get() = File(context.filesDir, "download-index.json")
    private val _records = MutableStateFlow(loadIndex())
    val records: StateFlow<List<DownloadRecord>> = _records
    private val _active = MutableStateFlow<Set<String>>(emptySet())
    /** Ключи треков, которые сейчас скачиваются. */
    val active: StateFlow<Set<String>> = _active
    private val albumsFile get() = File(context.filesDir, "download-albums.json")
    private val _albums = MutableStateFlow(loadAlbums())
    /** Альбомы, скачанные целиком; хранятся с треками, чтобы открываться без сети. */
    val albums: StateFlow<List<AlbumWithTracks>> = _albums

    fun saveAlbum(album: AlbumWithTracks) {
        val entry = album.copy(tracks = album.tracks.map { it.copy(streamUrl = null) })
        _albums.value = listOf(entry) + _albums.value.filterNot { it.source == album.source && it.id == album.id }
        persistAlbums()
    }

    fun removeAlbum(album: AlbumWithTracks) {
        _albums.value = _albums.value.filterNot { it.source == album.source && it.id == album.id }
        persistAlbums()
    }

    private fun persistAlbums() {
        albumsFile.writeText(json.encodeToString(_albums.value))
    }

    private fun loadAlbums(): List<AlbumWithTracks> {
        if (!albumsFile.exists()) return emptyList()
        return runCatching { json.decodeFromString<List<AlbumWithTracks>>(albumsFile.readText()) }.getOrDefault(emptyList())
    }

    fun enqueueOfflineMss(track: UnifiedTrack) {
        val key = keyOf(track)
        if (!begin(key)) return
        scope.launch {
            runCatching {
                val deviceId = preferences.getOrCreateDeviceId()
                runCatching { api.registerDevice(deviceId, android.os.Build.MODEL) }
                val bytes = api.offlinePackageBytes(track.id, deviceId)
                offline.savePackage(track.id, bytes)
                addRecord(
                    DownloadRecord(
                        key = key,
                        path = offline.packageFile(track.id).absolutePath,
                        codec = "mss",
                        size = bytes.size.toLong(),
                        downloadedAt = Instant.now().toString(),
                        track = track,
                    ),
                )
            }
            finish(key)
        }
    }

    fun enqueueYandex(track: UnifiedTrack) {
        val key = keyOf(track)
        if (!begin(key)) return
        scope.launch {
            val url = runCatching { yandex.resolvePlaybackUrl(track) }.getOrNull()
            if (url == null) {
                finish(key)
                return@launch
            }
            runWorker(key, url, "yandex_${track.id.substringBefore(':')}.mp3", "mp3", track)
        }
    }

    fun enqueue(url: String, fileName: String, track: UnifiedTrack) {
        val key = keyOf(track)
        if (!begin(key)) return
        scope.launch { runWorker(key, url, fileName, "bin", track) }
    }

    private suspend fun runWorker(key: String, url: String, fileName: String, codec: String, track: UnifiedTrack) {
        try {
            val req = OneTimeWorkRequestBuilder<TrackDownloadWorker>()
                .setInputData(workDataOf(TrackDownloadWorker.KEY_URL to url, TrackDownloadWorker.KEY_FILE to fileName))
                .build()
            val wm = WorkManager.getInstance(context)
            wm.enqueue(req)
            while (true) {
                val info = runCatching { wm.getWorkInfoById(req.id).get() }.getOrNull() ?: break
                if (info.state == WorkInfo.State.SUCCEEDED) {
                    val file = File(File(context.filesDir, "downloads"), fileName)
                    addRecord(
                        DownloadRecord(
                            key = key,
                            path = file.absolutePath,
                            codec = codec,
                            size = file.length(),
                            downloadedAt = Instant.now().toString(),
                            track = track,
                        ),
                    )
                    break
                }
                if (info.state.isFinished) break
                delay(500)
            }
        } finally {
            finish(key)
        }
    }

    private fun begin(key: String): Boolean {
        if (key in _active.value || _records.value.any { it.key == key }) return false
        _active.value = _active.value + key
        return true
    }

    private fun finish(key: String) {
        _active.value = _active.value - key
    }

    fun remove(key: String) {
        val rec = _records.value.find { it.key == key } ?: return
        File(rec.path).delete()
        if (rec.track.source == SourceId.LOCAL) {
            scope.launch { offline.remove(rec.track.id) }
        }
        _records.value = _records.value.filter { it.key != key }
        persist()
    }

    private fun addRecord(record: DownloadRecord) {
        _records.value = _records.value.filter { it.key != record.key } + record
        persist()
    }

    private fun persist() {
        indexFile.writeText(json.encodeToString(_records.value))
    }

    private fun loadIndex(): List<DownloadRecord> {
        if (!indexFile.exists()) return emptyList()
        return runCatching { json.decodeFromString<List<DownloadRecord>>(indexFile.readText()) }
            .getOrDefault(emptyList())
            .map { it.copy(key = keyOf(it.track)) }
    }

    companion object {
        fun keyOf(track: UnifiedTrack): String = "${track.source.name.lowercase()}:${track.id}"
    }
}
