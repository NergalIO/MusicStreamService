package com.mss.core.localtracks

import android.content.Context
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.freshCloudUrl
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Singleton
class CloudUrlStore @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val file get() = File(context.filesDir, "cloud-urls.json")
    private val lock = Any()

    fun remember(track: UnifiedTrack) {
        val play = freshCloudUrl(track.cloudPlayUrl, track.cloudUrlExpiresAt)
        val download = freshCloudUrl(track.cloudDownloadUrl, track.cloudUrlExpiresAt)
        if (play == null && download == null) return
        synchronized(lock) {
            val all = loadLocked().toMutableMap()
            all[track.id] = Entry(
                cloudPlayUrl = play ?: track.cloudPlayUrl,
                cloudDownloadUrl = download ?: track.cloudDownloadUrl,
                cloudUrlExpiresAt = track.cloudUrlExpiresAt,
            )
            persistLocked(all)
        }
    }

    fun mergeAndRemember(track: UnifiedTrack): UnifiedTrack {
        val cached = get(track.id)
        val merged = if (cached == null) {
            track
        } else {
            track.copy(
                cloudPlayUrl = freshCloudUrl(track.cloudPlayUrl, track.cloudUrlExpiresAt)
                    ?: cached.playUrl()
                    ?: track.cloudPlayUrl,
                cloudDownloadUrl = freshCloudUrl(track.cloudDownloadUrl, track.cloudUrlExpiresAt)
                    ?: cached.downloadUrl()
                    ?: track.cloudDownloadUrl,
                cloudUrlExpiresAt = track.cloudUrlExpiresAt ?: cached.cloudUrlExpiresAt,
            )
        }
        remember(merged)
        return merged
    }

    fun playUrl(trackId: String): String? = get(trackId)?.playUrl()

    fun downloadUrl(trackId: String): String? = get(trackId)?.downloadUrl()

    private fun get(trackId: String): Entry? = synchronized(lock) { loadLocked()[trackId] }

    private fun loadLocked(): Map<String, Entry> {
        if (!file.exists()) return emptyMap()
        return runCatching { json.decodeFromString<Map<String, Entry>>(file.readText()) }.getOrDefault(emptyMap())
    }

    private fun persistLocked(all: Map<String, Entry>) {
        file.writeText(json.encodeToString(all))
    }

    @Serializable
    private data class Entry(
        val cloudPlayUrl: String? = null,
        val cloudDownloadUrl: String? = null,
        val cloudUrlExpiresAt: String? = null,
    ) {
        fun playUrl(): String? = freshCloudUrl(cloudPlayUrl, cloudUrlExpiresAt)
        fun downloadUrl(): String? = freshCloudUrl(cloudDownloadUrl, cloudUrlExpiresAt)
    }
}
