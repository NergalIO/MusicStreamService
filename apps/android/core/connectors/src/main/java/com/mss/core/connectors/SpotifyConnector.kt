package com.mss.core.connectors

import com.mss.core.datastore.TokenVault
import com.mss.core.model.SourceId
import com.mss.core.model.TrackLyrics
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.Parameters
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Singleton
class SpotifyConnector @Inject constructor(
    private val vault: TokenVault,
    private val web: SpotifyWebSession,
    private val pathfinder: SpotifyPathfinder,
) : StreamConnector {
    override val id = SourceId.SPOTIFY
    override val displayName = "Spotify"

    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient(OkHttp)
    private val clientId = BuildConfig.SPOTIFY_CLIENT_ID

    override fun authStatus(): AuthStatus =
        if (web.loggedIn.value || web.hasPersistedSession()) AuthStatus.CONNECTED else AuthStatus.DISCONNECTED

    override suspend fun disconnect() {
        vault.delete(VAULT_KEY)
        web.logout()
    }

    suspend fun trackRadio(track: UnifiedTrack) = pathfinder.trackRadio(track.id)

    suspend fun lyrics(trackId: String): TrackLyrics? {
        if (!useWebCatalog()) throw ConnectorException("Войдите в Spotify")
        awaitWebPlayer()
        return pathfinder.lyrics(trackId)
    }

    override suspend fun search(query: String, limit: Int): List<UnifiedTrack> {
        if (useWebCatalog()) {
            awaitWebPlayer()
            return pathfinder.searchTracks(query, limit)
        }
        if (loadTokens() == null) throw ConnectorException("Spotify не подключён")
        val data = spotifyGet<SearchTracksResponse>(
            "/search",
            mapOf("q" to query, "type" to "track", "limit" to minOf(limit, 50).toString()),
        )
        return data.tracks.items.filterNotNull().map { mapTrack(it) }
    }

    override suspend fun listPlaylists(): List<UnifiedPlaylist> {
        if (useWebCatalog()) {
            awaitWebPlayer()
            return pathfinder.listPlaylists()
        }
        if (loadTokens() == null) throw ConnectorException("Spotify не подключён")
        val out = mutableListOf<UnifiedPlaylist>()
        var offset = 0
        while (out.size < 100) {
            val page = spotifyGet<PlaylistsPage>(
                "/me/playlists",
                mapOf("limit" to "50", "offset" to offset.toString()),
            )
            page.items.forEach { p ->
                out += UnifiedPlaylist(
                    source = SourceId.SPOTIFY,
                    id = p.id,
                    title = p.name,
                    owner = p.owner.displayName,
                    description = p.description,
                    coverUrl = SpotifyImageUrls.normalize(p.images.firstOrNull()?.url),
                    trackCount = p.tracks?.total ?: p.items?.total,
                )
            }
            if (page.next == null) break
            offset += 50
        }
        return out
    }

    override suspend fun savedTracks(limit: Int): List<UnifiedTrack> {
        if (useWebCatalog()) {
            awaitWebPlayer()
            return pathfinder.savedTracks(limit)
        }
        if (loadTokens() == null) throw ConnectorException("Spotify не подключён")
        val out = mutableListOf<UnifiedTrack>()
        var offset = 0
        while (out.size < limit) {
            val page = spotifyGet<SavedTracksPage>(
                "/me/tracks",
                mapOf("limit" to "50", "offset" to offset.toString(), "market" to "from_token"),
            )
            page.items.forEach { row ->
                row.track?.let { out += mapTrack(it) }
            }
            if (page.next == null || out.size >= limit) break
            offset += 50
        }
        return out.take(limit)
    }

    suspend fun playlist(id: String): com.mss.core.model.PlaylistWithTracks {
        if (useWebCatalog()) {
            awaitWebPlayer()
            return pathfinder.playlist(id)
        }
        if (loadTokens() == null) throw ConnectorException("Spotify не подключён")
        val meta = spotifyGet<SpotifyPlaylistDetail>("/playlists/$id", emptyMap())
        val tracks = mutableListOf<UnifiedTrack>()
        var offset = 0
        while (tracks.size < 500) {
            val page = spotifyGet<PlaylistTracksPage>(
                "/playlists/$id/tracks",
                mapOf("limit" to "100", "offset" to offset.toString()),
            )
            page.items.forEach { row -> row.track?.let { tracks += mapTrack(it) } }
            if (page.next == null) break
            offset += 100
        }
        return com.mss.core.model.PlaylistWithTracks(
            source = SourceId.SPOTIFY,
            id = id,
            title = meta.name,
            owner = meta.owner.displayName,
            description = meta.description,
            coverUrl = SpotifyImageUrls.normalize(meta.images.firstOrNull()?.url),
            trackCount = tracks.size,
            tracks = tracks,
        )
    }

    suspend fun album(id: String): com.mss.core.model.AlbumWithTracks {
        if (useWebCatalog()) {
            awaitWebPlayer()
            return pathfinder.album(id)
        }
        if (loadTokens() == null) throw ConnectorException("Spotify не подключён")
        val meta = spotifyGet<SpotifyAlbumDetail>("/albums/$id", emptyMap())
        val tracks = meta.tracks.items.filterNotNull().map { t ->
            mapTrack(t).copy(album = meta.name, coverUrl = SpotifyImageUrls.normalize(meta.images.firstOrNull()?.url))
        }
        return com.mss.core.model.AlbumWithTracks(
            source = SourceId.SPOTIFY,
            id = id,
            title = meta.name,
            artist = meta.artists.joinToString { it.name },
            coverUrl = SpotifyImageUrls.normalize(meta.images.firstOrNull()?.url),
            trackCount = tracks.size,
            tracks = tracks,
        )
    }

    override suspend fun resolvePlaybackUrl(track: UnifiedTrack): String {
        val token = accessToken()
        val res = http.get("https://api.spotify.com/v1/tracks/${track.id}") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        if (!res.status.isSuccess()) throw ConnectorException(res.bodyAsText())
        val data = json.decodeFromString<SpotifyTrackDetail>(res.bodyAsText())
        return data.previewUrl ?: throw ConnectorException("Полный трек Spotify — через веб-сессию")
    }

    suspend fun homeFeed() = if (useWebCatalog()) {
        awaitWebPlayer()
        runCatching { pathfinder.homeFeed() }.getOrDefault(emptyList())
    } else emptyList()

    suspend fun searchArtists(query: String, limit: Int): List<com.mss.core.model.UnifiedArtist> {
        if (useWebCatalog()) {
            awaitWebPlayer()
            return pathfinder.searchArtists(query, limit)
        }
        return emptyList()
    }

    suspend fun artistTracks(artistId: String, artistName: String?, limit: Int = 50): List<UnifiedTrack> {
        if (useWebCatalog()) {
            awaitWebPlayer()
            return pathfinder.artistTracks(artistId, artistName, limit)
        }
        return emptyList()
    }

    private fun useWebCatalog(): Boolean =
        web.loggedIn.value || web.headers != null || web.hasPersistedSession()

    private suspend fun awaitWebPlayer() {
        web.awaitHeaders()
    }

    private suspend fun accessToken(): String {
        val t = loadTokens() ?: throw ConnectorException("Spotify не подключён")
        if (System.currentTimeMillis() < t.expiresAt - 60_000) return t.accessToken
        val res = http.post("https://accounts.spotify.com/api/token") {
            contentType(ContentType.Application.FormUrlEncoded)
            setBody(
                FormDataContent(
                    Parameters.build {
                        append("grant_type", "refresh_token")
                        append("refresh_token", t.refreshToken)
                        append("client_id", clientId)
                    },
                ),
            )
        }
        if (!res.status.isSuccess()) {
            if (res.status.value == 400 || res.status.value == 401) vault.delete(VAULT_KEY)
            throw ConnectorException("Не удалось обновить сессию Spotify")
        }
        val data = json.decodeFromString<TokenResponse>(res.bodyAsText())
        val next = t.copy(
            accessToken = data.accessToken,
            refreshToken = data.refreshToken ?: t.refreshToken,
            expiresAt = System.currentTimeMillis() + data.expiresIn * 1000,
        )
        saveTokens(next)
        return next.accessToken
    }

    private suspend inline fun <reified T> spotifyGet(path: String, params: Map<String, String>): T {
        val token = accessToken()
        val url = buildString {
            append("https://api.spotify.com/v1")
            append(path)
            if (params.isNotEmpty()) {
                append('?')
                append(params.entries.joinToString("&") { "${it.key}=${java.net.URLEncoder.encode(it.value, Charsets.UTF_8)}" })
            }
        }
        val res = http.get(url) { header(HttpHeaders.Authorization, "Bearer $token") }
        val body = res.bodyAsText()
        if (!res.status.isSuccess()) {
            throw ConnectorException(SpotifyErrors.message(res.status.value, body, path))
        }
        return json.decodeFromString(body)
    }

    private fun mapTrack(t: SpotifyTrack): UnifiedTrack = UnifiedTrack(
        source = SourceId.SPOTIFY,
        id = t.id,
        title = t.name,
        artist = t.artists.joinToString { it.name },
        artists = t.artists.map { com.mss.core.model.ArtistRef(it.id.orEmpty(), it.name) }.takeIf { it.isNotEmpty() },
        album = t.album?.name,
        durationMs = t.durationMs,
        coverUrl = SpotifyImageUrls.normalize(t.album?.images?.firstOrNull()?.url),
        playable = true,
    )

    private fun loadTokens(): SpotifyTokens? {
        val raw = vault.get(VAULT_KEY) ?: return null
        return json.decodeFromString<SpotifyTokens>(raw)
    }

    private fun saveTokens(t: SpotifyTokens) {
        vault.set(VAULT_KEY, json.encodeToString(SpotifyTokens.serializer(), t))
    }

    companion object {
        private const val VAULT_KEY = "spotify_tokens"
    }
}

@Serializable
private data class SpotifyTokens(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_at") val expiresAt: Long,
)

@Serializable
private data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_in") val expiresIn: Int,
)

@Serializable
private data class SearchTracksResponse(val tracks: TracksBlock)

@Serializable
private data class TracksBlock(val items: List<SpotifyTrack?>)

@Serializable
private data class PlaylistsPage(val items: List<SpotifyPlaylist>, val next: String?)

@Serializable
private data class SpotifyPlaylist(
    val id: String,
    val name: String,
    val description: String? = null,
    val owner: SpotifyOwner,
    val images: List<SpotifyImage> = emptyList(),
    val tracks: CountRef? = null,
    val items: CountRef? = null,
)

@Serializable
private data class SpotifyOwner(@SerialName("display_name") val displayName: String? = null)

@Serializable
private data class CountRef(val total: Int)

@Serializable
private data class SpotifyImage(val url: String)

@Serializable
private data class SavedTracksPage(val items: List<SavedRow>, val next: String?)

@Serializable
private data class SavedRow(val track: SpotifyTrack?)

@Serializable
private data class SpotifyTrack(
    val id: String,
    val name: String,
    val artists: List<SpotifyArtistRef>,
    @SerialName("duration_ms") val durationMs: Long? = null,
    val album: SpotifyAlbumRef? = null,
)

@Serializable
private data class SpotifyArtistRef(val name: String, val id: String? = null)

@Serializable
private data class SpotifyAlbumRef(val name: String? = null, val images: List<SpotifyImage> = emptyList())

@Serializable
private data class SpotifyPlaylistDetail(
    val name: String,
    val description: String? = null,
    val owner: SpotifyOwner,
    val images: List<SpotifyImage> = emptyList(),
)

@Serializable
private data class PlaylistTracksPage(val items: List<SavedRow>, val next: String?)

@Serializable
private data class SpotifyAlbumDetail(
    val name: String,
    val artists: List<SpotifyArtistRef> = emptyList(),
    val images: List<SpotifyImage> = emptyList(),
    val tracks: AlbumTracksBlock,
)

@Serializable
private data class AlbumTracksBlock(val items: List<SpotifyTrack?>)

@Serializable
private data class SpotifyTrackDetail(@SerialName("preview_url") val previewUrl: String? = null)

private object SpotifyErrors {
    fun message(status: Int, raw: String, path: String): String {
        if (status == 403 && raw.contains("premium", ignoreCase = true)) {
            return "Spotify Development Mode: Premium у владельца приложения в Dashboard + User Management."
        }
        return raw.ifBlank { "Spotify API $status ($path)" }
    }
}
