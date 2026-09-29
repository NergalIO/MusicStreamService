package com.mss.core.downloads

import android.content.Context
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.mss.core.connectors.YandexConnector
import com.mss.core.datastore.MssPreferences
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

    fun enqueueOfflineMss(track: UnifiedTrack) {
        scope.launch {
            val deviceId = preferences.getOrCreateDeviceId()
            runCatching { api.registerDevice(deviceId, android.os.Build.MODEL) }
            val bytes = api.offlinePackageBytes(track.id, deviceId)
            offline.savePackage(track.id, bytes)
            addRecord(
                DownloadRecord(
                    key = "local:${track.id}",
                    path = offline.packageFile(track.id).absolutePath,
                    codec = "mss",
                    size = bytes.size.toLong(),
                    downloadedAt = Instant.now().toString(),
                    track = track,
                ),
            )
        }
    }

    fun enqueueYandex(track: UnifiedTrack) {
        scope.launch {
            val url = yandex.resolvePlaybackUrl(track)
            val name = "yandex_${track.id.substringBefore(':')}.mp3"
            val req = OneTimeWorkRequestBuilder<TrackDownloadWorker>()
                .setInputData(workDataOf(TrackDownloadWorker.KEY_URL to url, TrackDownloadWorker.KEY_FILE to name))
                .build()
            WorkManager.getInstance(context).enqueue(req)
            val path = File(File(context.filesDir, "downloads"), name).absolutePath
            addRecord(
                DownloadRecord(
                    key = "yandex:${track.id}",
                    path = path,
                    codec = "mp3",
                    downloadedAt = Instant.now().toString(),
                    track = track,
                ),
            )
        }
    }

    fun enqueue(url: String, fileName: String, track: UnifiedTrack) {
        val req = OneTimeWorkRequestBuilder<TrackDownloadWorker>()
            .setInputData(workDataOf(TrackDownloadWorker.KEY_URL to url, TrackDownloadWorker.KEY_FILE to fileName))
            .build()
        WorkManager.getInstance(context).enqueue(req)
        addRecord(
            DownloadRecord(
                key = "${track.source}:${track.id}",
                path = File(File(context.filesDir, "downloads"), fileName).absolutePath,
                downloadedAt = Instant.now().toString(),
                track = track,
            ),
        )
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
        return runCatching { json.decodeFromString<List<DownloadRecord>>(indexFile.readText()) }.getOrDefault(emptyList())
    }
}
