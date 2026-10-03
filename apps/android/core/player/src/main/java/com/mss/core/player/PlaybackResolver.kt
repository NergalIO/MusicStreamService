package com.mss.core.player

import android.net.Uri
import com.mss.core.connectors.ConnectorRegistry
import com.mss.core.connectors.SpotifyWebSession
import com.mss.core.datastore.MssPreferences
import com.mss.core.downloads.DownloadScheduler
import com.mss.core.localtracks.CloudUrlStore
import com.mss.core.localtracks.LocalTrackStore
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.freshCloudUrl
import com.mss.core.offline.OfflineStore
import javax.inject.Inject
import javax.inject.Singleton

sealed class ResolvedPlayback {
    data class Url(val url: String) : ResolvedPlayback()
    data class SpotifyWeb(val trackId: String) : ResolvedPlayback()
}

@Singleton
class PlaybackResolver @Inject constructor(
    private val preferences: MssPreferences,
    private val connectors: ConnectorRegistry,
    private val offline: OfflineStore,
    private val localTracks: LocalTrackStore,
    private val cloudUrls: CloudUrlStore,
    private val spotifyWeb: SpotifyWebSession,
    private val downloads: DownloadScheduler,
) {
    fun hasDownloadedFile(track: UnifiedTrack): Boolean = downloads.fileFor(track) != null

    suspend fun resolve(track: UnifiedTrack): ResolvedPlayback {
        downloads.fileFor(track)?.let { return ResolvedPlayback.Url(Uri.fromFile(it).toString()) }
        when (track.source) {
            SourceId.SPOTIFY -> {
                if (spotifyWeb.loggedIn.value || spotifyWeb.hasPersistedSession()) {
                    return ResolvedPlayback.SpotifyWeb(track.id)
                }
                throw com.mss.core.connectors.ConnectorException("Войдите в Spotify")
            }
            SourceId.YANDEX -> return ResolvedPlayback.Url(connectors.yandex.resolvePlaybackUrl(track))
            SourceId.VK -> {
                track.streamUrl?.takeIf { it.isNotBlank() }?.let { return ResolvedPlayback.Url(it) }
                return ResolvedPlayback.Url(connectors.vk.resolvePlaybackUrl(track))
            }
            SourceId.LOCAL -> {
                val session = preferences.loadSession()
                if (session != null && offline.hasPackage(track.id)) {
                    val file = offline.resolvePlayFile(session.user.id, track.id)
                    return ResolvedPlayback.Url(Uri.fromFile(file).toString())
                }
                localTracks.get(track.id)?.let { return ResolvedPlayback.Url(it.uri) }
                freshCloudUrl(track.cloudPlayUrl, track.cloudUrlExpiresAt)?.let { return ResolvedPlayback.Url(it) }
                cloudUrls.playUrl(track.id)?.let { return ResolvedPlayback.Url(it) }
                track.streamUrl?.let { return ResolvedPlayback.Url(it) }
                val base = preferences.getApiBaseUrl()
                return ResolvedPlayback.Url("$base/stream/${track.id}")
            }
        }
    }
}
