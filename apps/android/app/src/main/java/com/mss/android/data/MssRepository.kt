package com.mss.android.data

import android.net.Uri
import com.mss.core.connectors.AuthStatus
import com.mss.core.connectors.ConnectorRegistry
import com.mss.core.datastore.MssPreferences
import com.mss.core.localtracks.LocalTrackStore
import com.mss.core.model.AuthSession
import com.mss.core.model.CatalogArtistDto
import com.mss.core.model.HomeShelves
import com.mss.core.model.ListeningStats
import com.mss.core.model.LocalHolding
import com.mss.core.model.PlaylistDto
import com.mss.core.model.RegisterPending
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
    private val localTracks: LocalTrackStore,
) {
    val session = preferences.session
    val apiBase = preferences.apiBaseUrl
    val playbackSettings = preferences.playbackSettings
    val onboarded = preferences.onboarded
    val searchHistory = preferences.searchHistory

    suspend fun login(email: String, password: String): AuthSession {
        val s = api.login(email, password)
        val device = preferences.getOrCreateDeviceId()
        runCatching { api.registerDevice(device, android.os.Build.MODEL) }
        presence.connect(s.accessToken)
        return s
    }

    suspend fun register(email: String, password: String): RegisterPending = api.register(email, password)

    suspend fun verifyEmail(email: String, code: String): AuthSession {
        val s = api.verifyEmail(email, code)
        presence.connect(s.accessToken)
        return s
    }

    suspend fun resendVerification(email: String, password: String) = api.resendVerification(email, password)

    suspend fun logout() {
        runCatching { api.logoutServer() }
        presence.disconnect()
        preferences.clearSession()
    }

    suspend fun enterUiPreview() {
        preferences.setOnboarded(true)
        preferences.saveSession(
            AuthSession(
                accessToken = "preview",
                refreshToken = "preview",
                user = com.mss.core.model.AuthUser("preview", "preview@local"),
            ),
        )
    }

    suspend fun setApiBase(url: String) = preferences.setApiBaseUrl(url)

    suspend fun mssTracks(query: String = "", limit: Int = 50): List<UnifiedTrack> {
        val base = preferences.getApiBaseUrl()
        return api.searchTracks(query, limit).map { it.toUnifiedTrack(base) }
    }

    suspend fun getTrack(id: String): UnifiedTrack {
        val base = preferences.getApiBaseUrl()
        return api.getTrack(id).toUnifiedTrack(base)
    }

    suspend fun mssPlaylists(): List<UnifiedPlaylist> =
        api.listPlaylists().map { it.toUnifiedPlaylist() }

    suspend fun createPlaylist(name: String) = api.createPlaylist(name).toUnifiedPlaylist()

    suspend fun playlistDetail(id: String): Pair<PlaylistDto, List<UnifiedTrack>> {
        val base = preferences.getApiBaseUrl()
        val meta = api.getPlaylist(id)
        val tracks = api.playlistTracks(id).mapNotNull { it.toUnifiedTrack(base) }
        return meta to tracks
    }

    suspend fun mssLikes(): List<UnifiedTrack> {
        val base = preferences.getApiBaseUrl()
        return api.likedTracks().map { it.toUnifiedTrack(base) }
    }

    suspend fun toggleLike(track: UnifiedTrack, liked: Boolean) {
        if (track.source == SourceId.LOCAL) {
            if (liked) api.likeTrack(track.id) else api.unlikeTrack(track.id)
        } else if (track.source == SourceId.YANDEX) {
            connectors.yandex.setLike(track, liked)
        }
    }

    suspend fun playlistTracks(playlistId: String): List<UnifiedTrack> {
        val base = preferences.getApiBaseUrl()
        return api.playlistTracks(playlistId).mapNotNull { it.toUnifiedTrack(base) }
    }

    suspend fun searchAll(query: String, source: SourceId?, limit: Int = 30): List<UnifiedTrack> {
        preferences.addSearchQuery(query)
        val out = mutableListOf<UnifiedTrack>()
        if (source == null || source == SourceId.LOCAL) out += mssTracks(query, limit)
        if ((source == null || source == SourceId.YANDEX) && connectors.yandex.authStatus() != AuthStatus.DISCONNECTED) {
            out += connectors.yandex.search(query, limit)
        }
        if ((source == null || source == SourceId.SPOTIFY) && connectors.spotify.authStatus() != AuthStatus.DISCONNECTED) {
            out += connectors.spotify.search(query, limit)
        }
        if ((source == null || source == SourceId.VK) && connectors.vk.authStatus() != AuthStatus.DISCONNECTED) {
            out += connectors.vk.search(query, limit)
        }
        return out
    }

    suspend fun shelves(): HomeShelves = api.shelves()

    suspend fun stats(period: String, year: Int? = null): ListeningStats = api.stats(period, year)

    suspend fun subscription(): UserSubscriptionDto = api.subscription()

    suspend fun uploads(): List<UnifiedTrack> {
        val base = preferences.getApiBaseUrl()
        return api.myUploads().map { it.toUnifiedTrack(base) }
    }

    suspend fun artists(query: String = ""): List<CatalogArtistDto> = api.searchArtists(query)

    suspend fun artistTracks(name: String): List<UnifiedTrack> {
        val base = preferences.getApiBaseUrl()
        return api.artistTracks(name).map { it.toUnifiedTrack(base) }
    }

    suspend fun registerLocalFile(uri: Uri, title: String, artist: String): UnifiedTrack {
        localTracks.persistUri(uri)
        val (hash, size) = localTracks.hashUri(uri)
        val name = localTracks.displayName(uri)
        val dto = api.registerTrack(hash, title, artist, null, null, size, name)
        localTracks.put(LocalHolding(dto.id, uri.toString(), hash, name))
        return dto.toUnifiedTrack(preferences.getApiBaseUrl())
    }

    suspend fun activatePromo(code: String) = api.activatePromo(code)

    suspend fun deletePlaylist(id: String) = api.deletePlaylist(id)

    suspend fun addToPlaylist(playlistId: String, track: UnifiedTrack) {
        if (track.source == SourceId.LOCAL) {
            api.addPlaylistTrack(playlistId, track.id)
        } else {
            api.addPlaylistExternal(
                playlistId,
                track.source.name.lowercase(),
                track.id,
                track.title,
                track.artist,
                track.album,
                track.coverUrl,
                track.durationMs,
            )
        }
    }

    suspend fun renamePlaylist(id: String, name: String) = api.updatePlaylist(id, name)

    val connectorsRegistry get() = connectors
    val apiClient get() = api
    val prefs get() = preferences
}
