package com.mss.core.localtracks

import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.mss.core.model.LocalHolding
import com.mss.core.model.LyricsLine
import com.mss.core.model.TrackLyrics
import com.mss.core.model.parseLrc
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
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
        val digest = MessageDigest.getInstance("SHA-256")
        var size = 0L
        openInputStream(uri).use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                digest.update(buf, 0, n)
                size += n
            }
        }
        digest.digest().joinToString("") { "%02x".format(it) } to size
    }

    fun displayName(uri: Uri): String {
        val cr = context.contentResolver
        cr.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) return c.getString(0) ?: uri.lastPathSegment ?: "audio"
        }
        return uri.lastPathSegment ?: "audio"
    }

    fun mimeType(uri: Uri): String =
        context.contentResolver.getType(uri)?.takeIf { it.isNotBlank() && it != "application/octet-stream" }
            ?: com.mss.core.model.audioContentType(displayName(uri))

    fun sizeOf(uri: Uri): Long {
        if (uri.scheme == null || uri.scheme == "file") {
            val path = uri.path
            if (!path.isNullOrBlank()) {
                val n = File(path).length()
                if (n > 0) return n
            }
        }
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
                val i = c.getColumnIndex(OpenableColumns.SIZE)
                if (i >= 0) {
                    val n = c.getLong(i)
                    if (n > 0) return n
                }
            }
        }
        error("Не удалось определить размер файла")
    }

    fun openInputStream(uri: Uri): java.io.InputStream {
        if (uri.scheme == null || uri.scheme == "file") {
            val path = uri.path
            if (!path.isNullOrBlank()) {
                val file = File(path)
                if (file.exists()) return file.inputStream()
            }
        }
        return context.contentResolver.openInputStream(uri)
            ?: throw IllegalStateException("Не удалось прочитать файл")
    }

    /** Текст рядом с файлом: `track.lrc` (с таймингами) или `track.txt`, как на десктопе. */
    suspend fun lyrics(trackId: String): TrackLyrics? = withContext(Dispatchers.IO) {
        val raw = get(trackId)?.uri ?: return@withContext null
        readSidecar(Uri.parse(raw))
    }

    fun sidecarLyrics(uri: Uri): Pair<String, String>? {
        readText(sibling(uri, "lrc"))?.trim()?.takeIf { it.isNotEmpty() }?.let { return "lrc" to it }
        readText(sibling(uri, "txt"))?.trim()?.takeIf { it.isNotEmpty() }?.let { return "txt" to it }
        return null
    }

    private fun readSidecar(audio: Uri): TrackLyrics? {
        readText(sibling(audio, "lrc"))?.let { text ->
            val lines = parseLrc(text)
            if (lines.isNotEmpty()) return TrackLyrics(synced = true, lines = lines)
        }
        readText(sibling(audio, "txt"))?.let { text ->
            val lines = text.split(Regex("\\r?\\n")).map { it.trim() }.filter { it.isNotEmpty() }.map { LyricsLine(-1, it) }
            if (lines.isNotEmpty()) return TrackLyrics(synced = false, lines = lines)
        }
        return null
    }

    private fun sibling(audio: Uri, ext: String): Uri? {
        if (DocumentsContract.isDocumentUri(context, audio)) {
            val docId = runCatching { DocumentsContract.getDocumentId(audio) }.getOrNull() ?: return null
            val dot = docId.lastIndexOf('.')
            if (dot <= 0) return null
            return DocumentsContract.buildDocumentUri(audio.authority, docId.substring(0, dot) + "." + ext)
        }
        val path = when (audio.scheme) {
            null, "file" -> audio.path ?: audio.toString()
            else -> audio.toString()
        }
        val dot = path.lastIndexOf('.')
        val slash = path.lastIndexOf('/')
        if (dot <= slash) return null
        val next = path.substring(0, dot) + "." + ext
        return if (audio.scheme == null || audio.scheme == "file") Uri.fromFile(File(next)) else Uri.parse(next)
    }

    private fun readText(uri: Uri?): String? {
        if (uri == null) return null
        return runCatching {
            when (uri.scheme) {
                null, "file" -> File(uri.path ?: return null).takeIf { it.isFile }?.readText()
                else -> context.contentResolver.openInputStream(uri)?.use { it.readBytes().toString(Charsets.UTF_8) }
            }
        }.getOrNull()
    }

    fun readBytes(uri: Uri): ByteArray =
        context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
            ?: throw IllegalStateException("Не удалось прочитать файл")

    /** Встроенная обложка из ID3/MP4/FLAC, если она есть в файле. */
    fun embeddedPicture(uri: Uri): ByteArray? {
        val retriever = android.media.MediaMetadataRetriever()
        return try {
            retriever.setDataSource(context, uri)
            retriever.embeddedPicture
        } catch (_: Exception) {
            null
        } finally {
            runCatching { retriever.release() }
        }
    }
}
