package com.mss.android.data

import android.content.Context
import com.mss.core.model.AlbumWithTracks
import com.mss.core.model.SourceId
import com.mss.core.model.TrackLyrics
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.security.MessageDigest
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json

/** Лимит общего кеша. Читается синхронно при создании загрузчика картинок, поэтому SharedPreferences. */
object CacheSettings {
    val LIMITS_MB = listOf(200, 500, 1000, 2000)
    private const val DEFAULT_MB = 500
    private const val PREFS = "mss_cache"
    private const val KEY_LIMIT = "limit_mb"

    fun limitMb(context: Context): Int =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt(KEY_LIMIT, DEFAULT_MB)

    fun setLimitMb(context: Context, mb: Int) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putInt(KEY_LIMIT, mb).apply()
    }

    /** Картинкам — 90% лимита, спискам треков и текстам — остальное. */
    fun imageBytes(context: Context): Long = limitMb(context) * 1024L * 1024L * 9 / 10

    fun contentBytes(context: Context): Long = limitMb(context) * 1024L * 1024L / 10

    fun imageDir(context: Context): File = File(context.cacheDir, "image_cache")
}

/** Альбомы, тексты песен и ссылки на фото исполнителей в JSON на диске; давно не открытые удаляются по лимиту. */
@Singleton
class ContentCache @Inject constructor(@ApplicationContext private val context: Context) {
    private val json = Json { ignoreUnknownKeys = true }
    private val root = File(context.cacheDir, "content_cache")
    private val mutex = Mutex()

    suspend fun album(source: SourceId, id: String): AlbumWithTracks? =
        read("album", "$source:$id", AlbumWithTracks.serializer())

    suspend fun putAlbum(source: SourceId, id: String, album: AlbumWithTracks) {
        if (album.tracks.isEmpty()) return
        write("album", "$source:$id", AlbumWithTracks.serializer(), album.copy(tracks = album.tracks.map { it.copy(streamUrl = null) }))
    }

    suspend fun lyrics(source: SourceId, id: String): TrackLyrics? =
        read("lyrics", "$source:$id", TrackLyrics.serializer())

    suspend fun putLyrics(source: SourceId, id: String, lyrics: TrackLyrics) {
        if (lyrics.lines.isEmpty()) return
        write("lyrics", "$source:$id", TrackLyrics.serializer(), lyrics)
    }

    suspend fun artistImage(key: String): String? = read("artist", key, String.serializer())

    suspend fun putArtistImage(key: String, url: String) = write("artist", key, String.serializer(), url)

    suspend fun sizeBytes(): Long = withContext(Dispatchers.IO) {
        root.walkTopDown().filter { it.isFile }.sumOf { it.length() }
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        mutex.withLock { root.deleteRecursively() }
        Unit
    }

    suspend fun trim() = withContext(Dispatchers.IO) {
        mutex.withLock {
            val limit = CacheSettings.contentBytes(context)
            val files = root.walkTopDown().filter { it.isFile }.sortedBy { it.lastModified() }.toList()
            var total = files.sumOf { it.length() }
            for (f in files) {
                if (total <= limit) break
                val size = f.length()
                if (f.delete()) total -= size
            }
        }
    }

    private fun fileFor(kind: String, key: String): File {
        val hash = MessageDigest.getInstance("SHA-1").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(File(root, kind), "$hash.json")
    }

    private suspend fun <T> read(kind: String, key: String, serializer: KSerializer<T>): T? = withContext(Dispatchers.IO) {
        val file = fileFor(kind, key)
        if (!file.exists()) return@withContext null
        runCatching { json.decodeFromString(serializer, file.readText()) }
            .onSuccess { file.setLastModified(System.currentTimeMillis()) }
            .getOrNull()
    }

    private var writesSinceTrim = 0

    private suspend fun <T> write(kind: String, key: String, serializer: KSerializer<T>, value: T) {
        withContext(Dispatchers.IO) {
            mutex.withLock {
                runCatching {
                    val file = fileFor(kind, key)
                    file.parentFile?.mkdirs()
                    val tmp = File(file.parentFile, "${file.name}.tmp")
                    tmp.writeText(json.encodeToString(serializer, value))
                    if (!tmp.renameTo(file)) {
                        file.delete()
                        tmp.renameTo(file)
                    }
                }
            }
        }
        if (++writesSinceTrim >= TRIM_EVERY) {
            writesSinceTrim = 0
            trim()
        }
    }

    private companion object {
        const val TRIM_EVERY = 20
    }
}
