package com.mss.core.connectors

import com.mss.core.datastore.TokenVault
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import io.ktor.client.HttpClient
import io.ktor.client.call.body
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
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Singleton
class SpotifyConnector @Inject constructor(
    private val vault: TokenVault,
) : StreamConnector {
    override val id = SourceId.SPOTIFY
    override val displayName = "Spotify"

    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient(OkHttp)
    private val clientId = BuildConfig.SPOTIFY_CLIENT_ID
    private val redirectUri = "mss://spotify/callback"
    private val scopes =
        "user-read-email user-read-private streaming user-modify-playback-state user-read-playback-state user-library-read playlist-read-private playlist-read-collaborative"

    private var pendingVerifier: String? = null
    private var pendingState: String? = null

    override fun authStatus(): AuthStatus {
        val t = loadTokens() ?: return AuthStatus.DISCONNECTED
        return if (t.refreshToken.isNotBlank()) AuthStatus.CONNECTED else AuthStatus.DISCONNECTED
    }

    fun buildAuthorizeUrl(): String {
        val verifier = randomUrlSafe(32)
        val challenge = sha256Url(verifier)
        val state = randomUrlSafe(16)
        pendingVerifier = verifier
        pendingState = state
        return buildString {
            append("https://accounts.spotify.com/authorize?")
            append("client_id=").append(clientId)
            append("&response_type=code")
            append("&redirect_uri=").append(java.net.URLEncoder.encode(redirectUri, Charsets.UTF_8))
            append("&scope=").append(java.net.URLEncoder.encode(scopes, Charsets.UTF_8))
            append("&state=").append(state)
            append("&code_challenge_method=S256")
            append("&code_challenge=").append(challenge)
            append("&show_dialog=true")
        }
    }

    suspend fun completeOAuth(code: String, state: String) {
        if (state != pendingState) throw ConnectorException("Invalid OAuth state")
        val verifier = pendingVerifier ?: throw ConnectorException("Missing PKCE verifier")
        pendingVerifier = null
        pendingState = null
        if (clientId.isBlank()) throw ConnectorException("SPOTIFY_CLIENT_ID не задан в local.properties")
        val res = http.post("https://accounts.spotify.com/api/token") {
            contentType(ContentType.Application.FormUrlEncoded)
            setBody(
                FormDataContent(
                    Parameters.build {
                        append("grant_type", "authorization_code")
                        append("code", code)
                        append("redirect_uri", redirectUri)
                        append("client_id", clientId)
                        append("code_verifier", verifier)
                    },
                ),
            )
        }
        if (!res.status.isSuccess()) throw ConnectorException(res.bodyAsText())
        val data = json.decodeFromString<TokenResponse>(res.bodyAsText())
        if (data.refreshToken.isNullOrBlank()) throw ConnectorException("Spotify не выдал refresh_token")
        saveTokens(
            SpotifyTokens(
                accessToken = data.accessToken,
                refreshToken = data.refreshToken,
                expiresAt = System.currentTimeMillis() + data.expiresIn * 1000,
            ),
        )
    }

    override suspend fun disconnect() {
        vault.delete(VAULT_KEY)
    }

    override suspend fun search(query: String, limit: Int): List<UnifiedTrack> {
        val data = spotifyGet<SearchTracksResponse>(
            "/search",
            mapOf("q" to query, "type" to "track", "limit" to minOf(limit, 50).toString()),
        )
        return data.tracks.items.filterNotNull().map { mapTrack(it) }
    }

    override suspend fun listPlaylists(): List<UnifiedPlaylist> {
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
                    coverUrl = p.images.firstOrNull()?.url,
                    trackCount = p.tracks?.total ?: p.items?.total,
                )
            }
            if (page.next == null) break
            offset += 50
        }
        return out
    }

    override suspend fun savedTracks(limit: Int): List<UnifiedTrack> {
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

    override suspend fun resolvePlaybackUrl(track: UnifiedTrack): String {
        val token = accessToken()
        val res = http.get("https://api.spotify.com/v1/tracks/${track.id}") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        if (!res.status.isSuccess()) throw ConnectorException(res.bodyAsText())
        val data = json.decodeFromString<SpotifyTrackDetail>(res.bodyAsText())
        return data.previewUrl ?: throw ConnectorException("Полный трек Spotify — через Spotify Premium / SDK")
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
            append('?')
            append(params.entries.joinToString("&") { "${it.key}=${java.net.URLEncoder.encode(it.value, Charsets.UTF_8)}" })
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
        album = t.album?.name,
        durationMs = t.durationMs,
        coverUrl = t.album?.images?.firstOrNull()?.url,
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
private data class SpotifyArtistRef(val name: String)

@Serializable
private data class SpotifyAlbumRef(val name: String? = null, val images: List<SpotifyImage> = emptyList())

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

class ConnectorException(message: String) : Exception(message)

private fun randomUrlSafe(bytes: Int): String {
    val buf = ByteArray(bytes)
    SecureRandom().nextBytes(buf)
    return Base64.getUrlEncoder().withoutPadding().encodeToString(buf)
}

private fun sha256Url(verifier: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII))
    return Base64.getUrlEncoder().withoutPadding().encodeToString(digest)
}
