package com.mss.core.downloads

import android.content.Context
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.mss.core.connectors.AuthStatus
import com.mss.core.connectors.ConnectorException
import com.mss.core.connectors.SpotifyConnector
import com.mss.core.connectors.VkConnector
import com.mss.core.connectors.YandexConnector
import com.mss.core.datastore.MssPreferences
import com.mss.core.model.AlbumWithTracks
import com.mss.core.model.DownloadRecord
import com.mss.core.model.SourceId
import com.mss.core.model.TrackLyrics
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.lyricsFromSidecarFile
import com.mss.core.model.lyricsToSidecar
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
    private val vk: VkConnector,
    private val spotify: SpotifyConnector,
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
                saveLyricsSidecar(offline.packageFile(track.id), track)
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
            runWorker(key, url, fileNameFor(track, "mp3"), "mp3", track)
        }
    }

    /**
     * Spotify сам файл не отдаёт — ищем тот же трек в Яндексе или VK и качаем оттуда,
     * в индексе остаётся ключ `spotify:…`.
     */
    suspend fun enqueueSpotify(track: UnifiedTrack) {
        val key = keyOf(track)
        if (key in _active.value || _records.value.any { it.key == key }) return
        val copy = findDownloadableCopy(track)
        val url = directPlaybackUrl(copy) ?: throw ConnectorException(
            if (copy.source == SourceId.VK) {
                "Этот трек VK отдаётся потоком — скачать его на телефоне нельзя"
            } else {
                "Не удалось получить файл для скачивания"
            },
        )
        if (!begin(key)) return
        val ext = "mp3"
        scope.launch { runWorker(key, url, fileNameFor(track, ext), ext, track) }
    }

    fun fileFor(track: UnifiedTrack): File? {
        val rec = _records.value.find { it.key == keyOf(track) } ?: return null
        return File(rec.path).takeIf { it.exists() }
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
                    saveLyricsSidecar(file, track)
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
        deleteSidecars(rec.path)
        if (rec.track.source == SourceId.LOCAL) {
            scope.launch { offline.remove(rec.track.id) }
        }
        _records.value = _records.value.filter { it.key != key }
        persist()
    }

    fun lyricsSidecar(track: UnifiedTrack): TrackLyrics? {
        val rec = _records.value.find { it.key == keyOf(track) } ?: return null
        return lyricsFromSidecarFile(rec.path)
    }

    fun persistSidecar(track: UnifiedTrack, lyrics: TrackLyrics) {
        scope.launch {
            val rec = _records.value.find { it.key == keyOf(track) } ?: return@launch
            val sidecar = lyricsToSidecar(lyrics) ?: return@launch
            val base = rec.path.substringBeforeLast('.')
            File("$base.${sidecar.first}").writeText(sidecar.second)
            File("$base.${if (sidecar.first == "lrc") "txt" else "lrc"}").delete()
        }
    }

    private suspend fun saveLyricsSidecar(audio: File, track: UnifiedTrack) {
        val lyrics = runCatching {
            when (track.source) {
                SourceId.LOCAL -> api.trackLyrics(track.id)
                SourceId.YANDEX -> yandex.lyrics(track.id)
                SourceId.SPOTIFY -> spotify.lyrics(track.id)
                else -> null
            }
        }.getOrNull()
        val sidecar = lyricsToSidecar(lyrics) ?: return
        val base = audio.absolutePath.substringBeforeLast('.')
        File("$base.${sidecar.first}").writeText(sidecar.second)
        File("$base.${if (sidecar.first == "lrc") "txt" else "lrc"}").delete()
    }

    private fun deleteSidecars(audioPath: String) {
        val base = audioPath.substringBeforeLast('.')
        File("$base.lrc").delete()
        File("$base.txt").delete()
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

    private suspend fun findDownloadableCopy(track: UnifiedTrack): UnifiedTrack {
        val sources = buildList {
            if (yandex.authStatus() == AuthStatus.CONNECTED) add(SourceId.YANDEX)
            if (vk.authStatus() == AuthStatus.CONNECTED) add(SourceId.VK)
        }
        if (sources.isEmpty()) {
            throw ConnectorException("Spotify не отдаёт файлы — подключите Яндекс Музыку или VK, и трек скачается оттуда")
        }
        val query = SpotifyDownloadMatch.searchQuery(track)
        var sawCopy = false
        for (id in sources) {
            val found = runCatching {
                when (id) {
                    SourceId.YANDEX -> yandex.search(query, 10)
                    SourceId.VK -> vk.search(query, 10)
                    else -> emptyList()
                }
            }.getOrDefault(emptyList())
            for (candidate in found.filter { SpotifyDownloadMatch.isCopy(track, it) }) {
                sawCopy = true
                if (runCatching { directPlaybackUrl(candidate) }.getOrNull() != null) return candidate
            }
        }
        if (sawCopy) {
            throw ConnectorException("Нашли трек, но файл недоступен (часто VK отдаёт только поток). Попробуйте Яндекс Музыку")
        }
        throw ConnectorException("Не нашли этот трек в Яндекс Музыке и VK — Spotify не отдаёт файлы для скачивания")
    }

    private suspend fun directPlaybackUrl(track: UnifiedTrack): String? {
        val url = when (track.source) {
            SourceId.YANDEX -> yandex.resolvePlaybackUrl(track)
            SourceId.VK -> track.streamUrl?.takeIf { it.isNotBlank() } ?: vk.resolvePlaybackUrl(track)
            else -> return null
        }
        return url.takeIf { SpotifyDownloadMatch.isDirectFileUrl(it) }
    }

    private fun fileNameFor(track: UnifiedTrack, ext: String): String {
        val base = "${track.artist} - ${track.title}"
            .replace(Regex("[<>:\"/\\\\|?*\\u0000-\\u001f]"), "_")
            .replace(Regex("\\s+"), " ")
            .trim()
            .replace(Regex("[. ]+$"), "")
            .take(150)
            .ifBlank { "track" }
        val idPart = track.id.take(16).replace(Regex("[^A-Za-z0-9_-]"), "_")
        return "${base.take(80)}_$idPart.$ext"
    }

    companion object {
        fun keyOf(track: UnifiedTrack): String = "${track.source.name.lowercase()}:${track.id}"
    }
}
