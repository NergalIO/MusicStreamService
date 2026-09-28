package com.mss.core.connectors

import com.mss.core.datastore.MssPreferences
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedTrack
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PlaybackResolver @Inject constructor(
    private val preferences: MssPreferences,
    private val connectors: ConnectorRegistry,
) {
    suspend fun resolveUrl(track: UnifiedTrack): String {
        when (track.source) {
            SourceId.LOCAL -> {
                track.streamUrl?.let { return it }
                val base = preferences.getApiBaseUrl()
                return "$base/stream/${track.id}"
            }
            SourceId.YANDEX -> return connectors.yandex.resolvePlaybackUrl(track)
            SourceId.SPOTIFY -> return connectors.spotify.resolvePlaybackUrl(track)
        }
    }
}
