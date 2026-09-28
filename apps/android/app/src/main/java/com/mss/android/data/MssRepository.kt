package com.mss.android.data

import com.mss.core.connectors.ConnectorRegistry
import com.mss.core.datastore.MssPreferences
import com.mss.core.model.AuthSession
import com.mss.core.model.ListeningStats
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.UserSubscriptionDto
import com.mss.core.model.toUnifiedPlaylist
import com.mss.core.model.toUnifiedTrack
import com.mss.core.network.MssApiClient
import com.mss.core.network.PresenceClient
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class MssRepository @Inject constructor(
    private val api: MssApiClient,
    private val preferences: MssPreferences,
    private val connectors: ConnectorRegistry,
    private val presence: PresenceClient,
) {
    val session = preferences.session
    val apiBase = preferences.apiBaseUrl

    suspend fun login(email: String, password: String): AuthSession {
        val s = api.login(email, password)
        presence.connect(s.accessToken)
        return s
    }

    suspend fun register(email: String, password: String): AuthSession {
        val s = api.register(email, password)
        presence.connect(s.accessToken)
        return s
    }

    suspend fun logout() {
        presence.disconnect()
        preferences.clearSession()
    }

    suspend fun setApiBase(url: String) = preferences.setApiBaseUrl(url)

    suspend fun mssTracks(query: String = "", limit: Int = 50): List<UnifiedTrack> {
        val base = preferences.getApiBaseUrl()
        return api.searchTracks(query, limit).map { it.toUnifiedTrack(base) }
    }

    suspend fun mssPlaylists(): List<UnifiedPlaylist> =
        api.listPlaylists().map { it.toUnifiedPlaylist() }

    suspend fun mssLikes(): List<UnifiedTrack> {
        val base = preferences.getApiBaseUrl()
        return api.likedTracks().map { it.toUnifiedTrack(base) }
    }

    suspend fun playlistTracks(playlistId: String): List<UnifiedTrack> {
        val base = preferences.getApiBaseUrl()
        return api.playlistTracks(playlistId).map { it.toUnifiedTrack(base) }
    }

    suspend fun searchAll(query: String, source: SourceId?, limit: Int = 30): List<UnifiedTrack> {
        val out = mutableListOf<UnifiedTrack>()
        if (source == null || source == SourceId.LOCAL) out += mssTracks(query, limit)
        if (source == null || source == SourceId.YANDEX) {
            if (connectors.yandex.authStatus() != com.mss.core.connectors.AuthStatus.DISCONNECTED) {
                out += connectors.yandex.search(query, limit)
            }
        }
        if (source == null || source == SourceId.SPOTIFY) {
            if (connectors.spotify.authStatus() != com.mss.core.connectors.AuthStatus.DISCONNECTED) {
                out += connectors.spotify.search(query, limit)
            }
        }
        return out
    }

    suspend fun stats(period: String): ListeningStats = api.stats(period)

    suspend fun subscription(): UserSubscriptionDto = api.subscription()
}
