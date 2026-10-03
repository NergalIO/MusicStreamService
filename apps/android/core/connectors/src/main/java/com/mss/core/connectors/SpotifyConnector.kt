package com.mss.core.connectors

import com.mss.core.model.SourceId
import com.mss.core.model.TrackLyrics
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class SpotifyConnector @Inject constructor(
    private val web: SpotifyWebSession,
    private val pathfinder: SpotifyPathfinder,
) : StreamConnector {
    override val id = SourceId.SPOTIFY
    override val displayName = "Spotify"

    override fun authStatus(): AuthStatus = when {
        web.sessionRejected -> AuthStatus.EXPIRED
        web.loggedIn.value || web.hasPersistedSession() -> AuthStatus.CONNECTED
        else -> AuthStatus.DISCONNECTED
    }

    override suspend fun disconnect() {
        web.logout()
    }

    suspend fun trackRadio(track: UnifiedTrack) = pathfinder.trackRadio(track.id)

    suspend fun lyrics(trackId: String): TrackLyrics? {
        requireWeb()
        return pathfinder.lyrics(trackId)
    }

    override suspend fun search(query: String, limit: Int): List<UnifiedTrack> {
        requireWeb()
        return pathfinder.searchTracks(query, limit)
    }

    override suspend fun listPlaylists(): List<UnifiedPlaylist> {
        requireWeb()
        return pathfinder.listPlaylists()
    }

    override suspend fun savedTracks(limit: Int): List<UnifiedTrack> {
        requireWeb()
        return pathfinder.savedTracks(limit)
    }

    suspend fun playlist(id: String): com.mss.core.model.PlaylistWithTracks {
        requireWeb()
        return pathfinder.playlist(id)
    }

    suspend fun album(id: String): com.mss.core.model.AlbumWithTracks {
        requireWeb()
        return pathfinder.album(id)
    }

    override suspend fun resolvePlaybackUrl(track: UnifiedTrack): String {
        throw ConnectorException("Полный трек Spotify — через веб-сессию")
    }

    suspend fun homeFeed() = runCatching {
        requireWeb()
        pathfinder.homeFeed()
    }.getOrDefault(emptyList())

    suspend fun searchArtists(query: String, limit: Int): List<com.mss.core.model.UnifiedArtist> {
        requireWeb()
        return pathfinder.searchArtists(query, limit)
    }

    suspend fun artist(id: String): com.mss.core.model.UnifiedArtist? {
        if (!isWebReady()) return null
        return runCatching {
            requireWeb()
            pathfinder.artist(id)
        }.getOrNull()
    }

    suspend fun artistProfile(id: String): com.mss.core.model.ArtistProfile? {
        if (!isWebReady()) return null
        return runCatching {
            requireWeb()
            pathfinder.artistProfile(id)
        }.getOrNull()
    }

    suspend fun artistTracks(artistId: String, artistName: String?, limit: Int = 50): List<UnifiedTrack> {
        requireWeb()
        return pathfinder.artistTracks(artistId, artistName, limit)
    }

    suspend fun searchAlbums(query: String, limit: Int): List<com.mss.core.model.UnifiedAlbum> {
        requireWeb()
        return pathfinder.searchAlbums(query, limit)
    }

    private fun isWebReady(): Boolean =
        web.loggedIn.value || web.headers != null || web.hasPersistedSession()

    private suspend fun requireWeb() {
        if (!isWebReady()) throw ConnectorException("Войдите в Spotify")
        web.awaitHeaders()
    }
}
