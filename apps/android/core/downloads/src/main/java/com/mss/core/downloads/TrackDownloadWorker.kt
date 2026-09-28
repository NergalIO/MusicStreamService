package com.mss.core.downloads

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class TrackDownloadWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val url = inputData.getString(KEY_URL) ?: return@withContext Result.failure()
        val fileName = inputData.getString(KEY_FILE) ?: return@withContext Result.failure()
        val dir = File(applicationContext.filesDir, "downloads").apply { mkdirs() }
        val out = File(dir, fileName)
        try {
            val res = OkHttpClient().newCall(Request.Builder().url(url).build()).execute()
            if (!res.isSuccessful) return@withContext Result.retry()
            res.body?.byteStream()?.use { input ->
                out.outputStream().use { output -> input.copyTo(output) }
            }
            Result.success(workDataOf(KEY_PATH to out.absolutePath))
        } catch (_: Exception) {
            Result.retry()
        }
    }

    companion object {
        const val KEY_URL = "url"
        const val KEY_FILE = "file"
        const val KEY_PATH = "path"
        const val WORK_NAME = "mss_track_download"
    }
}
