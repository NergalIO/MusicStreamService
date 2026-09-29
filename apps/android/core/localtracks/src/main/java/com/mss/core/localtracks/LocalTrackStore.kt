package com.mss.core.localtracks

import android.content.Context
import android.net.Uri
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.mss.core.model.LocalHolding
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val Context.holdingsStore by preferencesDataStore("mss_holdings")

@Singleton
class LocalTrackStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val key = stringPreferencesKey("holdings")

    suspend fun all(): List<LocalHolding> {
        val raw = context.holdingsStore.data.first()[key] ?: return emptyList()
        return json.decodeFromString(raw)
    }

    suspend fun get(trackId: String): LocalHolding? = all().find { it.trackId == trackId }

    suspend fun put(holding: LocalHolding) {
        val next = all().filter { it.trackId != holding.trackId } + holding
        context.holdingsStore.edit { it[key] = json.encodeToString(next) }
    }

    suspend fun remove(trackId: String) {
        val next = all().filter { it.trackId != trackId }
        context.holdingsStore.edit { it[key] = json.encodeToString(next) }
    }

    suspend fun persistUri(uri: Uri) {
        runCatching {
            context.contentResolver.takePersistableUriPermission(
                uri,
                android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
    }

    suspend fun hashUri(uri: Uri): Pair<String, Long> = withContext(Dispatchers.IO) {
        val cr = context.contentResolver
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        cr.openInputStream(uri)?.use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                digest.update(buf, 0, n)
                size += n
            }
        } ?: throw IllegalStateException("Не удалось прочитать файл")
        digest.digest().joinToString("") { "%02x".format(it) } to size
    }

    fun displayName(uri: Uri): String {
        val cr = context.contentResolver
        cr.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) return c.getString(0) ?: uri.lastPathSegment ?: "audio"
        }
        return uri.lastPathSegment ?: "audio"
    }

    fun readBytes(uri: Uri): ByteArray =
        context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IllegalStateException("Не удалось прочитать файл")
}
