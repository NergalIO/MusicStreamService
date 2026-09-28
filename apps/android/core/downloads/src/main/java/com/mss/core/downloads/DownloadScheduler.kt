package com.mss.core.downloads

import android.content.Context
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import com.mss.core.datastore.MssPreferences
import com.mss.core.network.MssApiClient
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

@Singleton
class DownloadScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val api: MssApiClient,
    private val preferences: MssPreferences,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun enqueueOfflineMss(trackId: String) {
        scope.launch {
            val deviceId = preferences.getOrCreateDeviceId()
            runCatching { api.registerDevice(deviceId, android.os.Build.MODEL) }
            val bytes = api.offlinePackageBytes(trackId, deviceId)
            val dir = java.io.File(context.filesDir, "downloads").apply { mkdirs() }
            java.io.File(dir, "$trackId.mss").writeBytes(bytes)
        }
    }

    fun enqueue(url: String, fileName: String) {
        val req = OneTimeWorkRequestBuilder<TrackDownloadWorker>()
            .setInputData(
                workDataOf(
                    TrackDownloadWorker.KEY_URL to url,
                    TrackDownloadWorker.KEY_FILE to fileName,
                ),
            )
            .build()
        WorkManager.getInstance(context).enqueue(req)
    }
}
