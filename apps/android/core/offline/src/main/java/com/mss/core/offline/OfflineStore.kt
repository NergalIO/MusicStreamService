package com.mss.core.offline

import android.content.Context
import com.mss.core.datastore.MssPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

@Singleton
class OfflineStore @Inject constructor(
    @ApplicationContext private val context: Context,
    private val preferences: MssPreferences,
) {
    private val secret = BuildConfig.OFFLINE_HKDF_SECRET
    private val dir get() = File(context.filesDir, "offline").apply { mkdirs() }
    private val decodedDir get() = File(context.cacheDir, "offline-decoded").apply { mkdirs() }

    fun packageFile(trackId: String) = File(dir, "$trackId.mss")

    fun hasPackage(trackId: String) = packageFile(trackId).exists()

    fun listTrackIds(): List<String> =
        dir.listFiles()?.filter { it.extension == "mss" }?.map { it.nameWithoutExtension } ?: emptyList()

    suspend fun savePackage(trackId: String, bytes: ByteArray) = withContext(Dispatchers.IO) {
        packageFile(trackId).writeBytes(bytes)
    }

    suspend fun remove(trackId: String) = withContext(Dispatchers.IO) {
        packageFile(trackId).delete()
        File(decodedDir, "$trackId.ogg").delete()
    }

    suspend fun resolvePlayFile(userId: String, trackId: String): File = withContext(Dispatchers.IO) {
        val cached = File(decodedDir, "$trackId.ogg")
        if (cached.exists() && cached.length() > 0) return@withContext cached
        val packed = packageFile(trackId)
        if (!packed.exists()) throw IllegalStateException("Нет офлайн-пакета")
        val deviceId = preferences.getOrCreateDeviceId()
        val key = MssFormat.deriveContentKey(userId, deviceId, trackId, secret)
        val (_, payload) = MssFormat.decode(packed.readBytes(), deviceId, key, secret)
        cached.writeBytes(payload)
        cached
    }
}
