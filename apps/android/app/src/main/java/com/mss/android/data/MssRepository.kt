package com.mss.android.data

import android.net.Uri
import com.mss.core.connectors.AuthStatus
import com.mss.core.connectors.ConnectorRegistry
import com.mss.core.datastore.MssPreferences
import com.mss.core.localtracks.CloudUrlStore
import com.mss.core.localtracks.LocalTrackStore
import com.mss.core.model.AuthSession
import com.mss.core.model.CatalogArtistDto
import com.mss.core.model.HomeShelves
import com.mss.core.model.ListeningStats
import com.mss.core.model.LocalHolding
import com.mss.core.model.PlaylistDto
import com.mss.core.model.RegisterPending
import com.mss.core.model.SourceId
import com.mss.core.model.TrackDto
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.UserSubscriptionDto
import com.mss.core.model.audioContentType
import com.mss.core.model.freshCloudUrl
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
    private val cloudUrls: CloudUrlStore,
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
        // Токены и cookie сервисов живут отдельно от сессии MSS: без этого следующий
        // пользователь устройства попадёт в чужие Яндекс, Spotify и VK.
        connectors.all().forEach { runCatching { it.disconnect() } }
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

    suspend fun mssTracks(query: String = "", limit: Int = 50): List<UnifiedTrack> =
        api.searchTracks(query, limit).map { unify(it) }

    suspend fun getTrack(id: String): UnifiedTrack = unify(api.getTrack(id))

    suspend fun mssPlaylists(): List<UnifiedPlaylist> =
        api.listPlaylists().map { it.toUnifiedPlaylist() }

    suspend fun createPlaylist(name: String) = api.createPlaylist(name).toUnifiedPlaylist()

    suspend fun playlistDetail(id: String): Pair<PlaylistDto, List<UnifiedTrack>> {
        val meta = api.getPlaylist(id)
        val tracks = api.playlistTracks(id).mapNotNull { it.toUnifiedTrack(preferences.getApiBaseUrl())?.let(cloudUrls::mergeAndRemember) }
        return meta to tracks
    }

    suspend fun mssLikes(): List<UnifiedTrack> = api.likedTracks().map { unify(it) }

    suspend fun toggleLike(track: UnifiedTrack, liked: Boolean) {
        if (track.source == SourceId.LOCAL) {
            if (liked) api.likeTrack(track.id) else api.unlikeTrack(track.id)
        } else if (track.source == SourceId.YANDEX) {
            connectors.yandex.setLike(track, liked)
        }
    }

    suspend fun playlistTracks(playlistId: String): List<UnifiedTrack> =
        api.playlistTracks(playlistId).mapNotNull { it.toUnifiedTrack(preferences.getApiBaseUrl())?.let(cloudUrls::mergeAndRemember) }

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

    suspend fun uploads(): List<UnifiedTrack> = api.myUploads().map { unify(it) }

    suspend fun artists(query: String = ""): List<CatalogArtistDto> = api.searchArtists(query)

    suspend fun artistTracks(name: String): List<UnifiedTrack> = api.artistTracks(name).map { unify(it) }

    suspend fun registerLocalFile(uri: Uri, title: String, artist: String): UnifiedTrack {
        localTracks.persistUri(uri)
        val (hash, size) = localTracks.hashUri(uri)
        val name = localTracks.displayName(uri)
        val dto = api.registerTrack(hash, title, artist, null, null, size, name)
        localTracks.put(LocalHolding(dto.id, uri.toString(), hash, name))
        val contentType = localTracks.mimeType(uri).ifBlank { audioContentType(name) }
        val cloud = api.cloudUpload(dto.id, contentType)
        if (!cloud.skipUpload) {
            val url = cloud.uploadUrl ?: error("Сервер не выдал ссылку загрузки")
            localTracks.openInputStream(uri).use { input ->
                api.putToUrl(url, contentType, size, input)
            }
        }
        val done: TrackDto = if (cloud.alreadyReady) {
            dto.copy(
                cloudPlayUrl = cloud.cloudPlayUrl ?: dto.cloudPlayUrl,
                cloudDownloadUrl = cloud.cloudDownloadUrl ?: dto.cloudDownloadUrl,
                cloudUrlExpiresAt = cloud.cloudUrlExpiresAt ?: dto.cloudUrlExpiresAt,
                status = cloud.status ?: dto.status,
                coverUrl = cloud.coverUrl ?: dto.coverUrl,
            )
        } else {
            api.cloudComplete(dto.id)
        }
        return unify(done)
    }

    suspend fun resolveCloudDownloadUrl(track: UnifiedTrack): String? {
        freshCloudUrl(track.cloudDownloadUrl, track.cloudUrlExpiresAt)?.let { return it }
        cloudUrls.downloadUrl(track.id)?.let { return it }
        return runCatching { api.trackDownloadUrl(track.id) }.getOrNull()
    }

    private suspend fun unify(dto: TrackDto): UnifiedTrack =
        cloudUrls.mergeAndRemember(dto.toUnifiedTrack(preferences.getApiBaseUrl()))

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
