package com.mss.core.network

import com.mss.core.datastore.MssPreferences
import com.mss.core.model.AuthSession
import com.mss.core.model.HomeShelves
import com.mss.core.model.ListeningStats
import com.mss.core.model.LobbyDto
import com.mss.core.model.LobbyListDto
import com.mss.core.model.LobbyPlaybackState
import com.mss.core.model.LobbyQueueItemDto
import com.mss.core.model.PlayEvent
import com.mss.core.model.PlaylistDto
import com.mss.core.model.PlaylistEntryDto
import com.mss.core.model.PlaylistTracksResponse
import com.mss.core.model.PlaylistsResponse
import com.mss.core.model.RefreshResponse
import com.mss.core.model.RegisterPending
import com.mss.core.model.TrackDto
import com.mss.core.model.TracksResponse
import com.mss.core.model.CatalogArtistDto
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.UserSubscriptionDto
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.delete
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

@Singleton
class MssApiClient @Inject constructor(
    private val preferences: MssPreferences,
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; encodeDefaults = true }
    private val refreshMutex = Mutex()

    val http = HttpClient(OkHttp) {
        install(ContentNegotiation) { json(json) }
    }

    suspend fun apiBase(): String = preferences.getApiBaseUrl()

    suspend fun login(email: String, password: String): AuthSession {
        val base = apiBase()
        val res = http.post("$base/auth/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginBody(email, password))
        }
        val text = res.bodyAsText()
        if (res.status.value == 403) {
            val err = runCatching { json.decodeFromString<AuthErrorBody>(text) }.getOrNull()
            if (err?.code == "EMAIL_NOT_VERIFIED") {
                throw EmailNotVerifiedException(err.email ?: email, err.message ?: "Подтвердите email")
            }
        }
        if (!res.status.isSuccess()) throw ApiException(text)
        val session = json.decodeFromString<AuthSession>(text)
        preferences.saveSession(session)
        return session
    }

    suspend fun register(email: String, password: String): RegisterPending {
        val base = apiBase()
        val res = http.post("$base/auth/register") {
            contentType(ContentType.Application.Json)
            setBody(LoginBody(email, password))
        }
        val text = res.bodyAsText()
        if (!res.status.isSuccess()) throw ApiException(text)
        return json.decodeFromString<RegisterPending>(text)
    }

    suspend fun verifyEmail(email: String, code: String): AuthSession {
        val base = apiBase()
        val res = http.post("$base/auth/verify-email") {
            contentType(ContentType.Application.Json)
            setBody(VerifyEmailBody(email, code))
        }
        val text = res.bodyAsText()
        if (!res.status.isSuccess()) throw ApiException(text)
        val session = json.decodeFromString<AuthSession>(text)
        preferences.saveSession(session)
        return session
    }

    suspend fun resendVerification(email: String, password: String) {
        val base = apiBase()
        val res = http.post("$base/auth/resend-verification") {
            contentType(ContentType.Application.Json)
            setBody(LoginBody(email, password))
        }
        if (!res.status.isSuccess()) throw ApiException(res.bodyAsText())
    }

    suspend fun logoutServer() {
        val session = preferences.loadSession() ?: return
        runCatching {
            http.post("${apiBase()}/auth/logout") {
                contentType(ContentType.Application.Json)
                setBody(RefreshBody(session.refreshToken))
            }
        }
    }

    suspend fun refreshAccessToken(): Boolean = refreshMutex.withLock {
        val session = preferences.loadSession() ?: return false
        val base = apiBase()
        val res = http.post("$base/auth/refresh") {
            contentType(ContentType.Application.Json)
            setBody(RefreshBody(session.refreshToken))
        }
        if (!res.status.isSuccess()) return false
        val data = res.body<RefreshResponse>()
        preferences.updateAccessToken(data.accessToken)
        true
    }

    suspend fun searchTracks(query: String, limit: Int = 50, offset: Int = 0): List<TrackDto> {
        val res = authorizedGet("${apiBase()}/tracks?query=${encode(query)}&limit=$limit&offset=$offset")
        return res.body<TracksResponse>().items
    }

    suspend fun getTrack(id: String): TrackDto {
        val res = authorizedGet("${apiBase()}/tracks/$id")
        return res.body()
    }

    suspend fun listPlaylists(): List<PlaylistDto> {
        val res = authorizedGet("${apiBase()}/playlists")
        return res.body<PlaylistsResponse>().items
    }

    suspend fun getPlaylist(id: String): PlaylistDto {
        val res = authorizedGet("${apiBase()}/playlists/$id")
        return res.body()
    }

    suspend fun createPlaylist(name: String, description: String? = null): PlaylistDto {
        val res = authorizedPost("${apiBase()}/playlists", CreatePlaylistBody(name, description))
        return res.body()
    }

    suspend fun updatePlaylist(id: String, name: String? = null, description: String? = null, author: String? = null): PlaylistDto {
        val res = withAuth { token ->
            http.patch("${apiBase()}/playlists/$id") {
                header(HttpHeaders.Authorization, "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(UpdatePlaylistBody(name, description, author))
            }
        }
        return res.body()
    }

    suspend fun deletePlaylist(id: String) {
        withAuth { token ->
            http.delete("${apiBase()}/playlists/$id") { header(HttpHeaders.Authorization, "Bearer $token") }
        }
    }

    suspend fun playlistTracks(playlistId: String): List<PlaylistEntryDto> {
        val res = authorizedGet("${apiBase()}/playlists/$playlistId/tracks")
        return res.body<PlaylistTracksResponse>().items
    }

    suspend fun addPlaylistTrack(playlistId: String, trackId: String) {
        authorizedPost("${apiBase()}/playlists/$playlistId/tracks", AddTrackBody(trackId))
    }

    suspend fun addPlaylistExternal(
        playlistId: String,
        source: String,
        externalId: String,
        title: String,
        artist: String,
        album: String? = null,
        coverUrl: String? = null,
        durationMs: Long? = null,
    ) {
        authorizedPost(
            "${apiBase()}/playlists/$playlistId/tracks",
            AddExternalBody(
                items = listOf(
                    ExternalItem(
                        source = source,
                        externalId = externalId,
                        snapshot = SnapshotBody(title, artist, album, coverUrl, durationMs),
                    ),
                ),
            ),
        )
    }

    suspend fun removePlaylistEntry(playlistId: String, entryId: String) {
        withAuth { token ->
            http.delete("${apiBase()}/playlists/$playlistId/entries/$entryId") {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
        }
    }

    suspend fun reorderPlaylist(playlistId: String, entryIds: List<String>) {
        withAuth { token ->
            http.put("${apiBase()}/playlists/$playlistId/tracks/order") {
                header(HttpHeaders.Authorization, "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(ReorderBody(entryIds))
            }
        }
    }

    suspend fun likedTracks(): List<TrackDto> {
        val res = authorizedGet("${apiBase()}/me/likes")
        return res.body<TracksResponse>().items
    }

    suspend fun likeTrack(trackId: String) {
        authorizedPost("${apiBase()}/tracks/$trackId/like", EmptyBody())
    }

    suspend fun unlikeTrack(trackId: String) {
        withAuth { token ->
            http.delete("${apiBase()}/tracks/$trackId/like") { header(HttpHeaders.Authorization, "Bearer $token") }
        }
    }

    suspend fun myUploads(): List<TrackDto> {
        val res = authorizedGet("${apiBase()}/me/uploads")
        return res.body<TracksResponse>().items
    }

    suspend fun registerTrack(
        contentHash: String,
        title: String,
        artist: String,
        album: String?,
        durationMs: Long?,
        sizeBytes: Long,
        originalFilename: String,
    ): TrackDto {
        val res = authorizedPost(
            "${apiBase()}/tracks/register",
            RegisterTrackBody(contentHash, title, artist, album, durationMs, sizeBytes, originalFilename),
        )
        return res.body()
    }

    suspend fun patchTrack(id: String, title: String?, artist: String?, album: String?) {
        withAuth { token ->
            http.patch("${apiBase()}/tracks/$id") {
                header(HttpHeaders.Authorization, "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(UpdateTrackBody(title, artist, album))
            }
        }
    }

    suspend fun deleteTrack(id: String) {
        withAuth { token ->
            http.delete("${apiBase()}/tracks/$id") { header(HttpHeaders.Authorization, "Bearer $token") }
        }
    }

    suspend fun searchArtists(query: String): List<CatalogArtistDto> {
        val res = authorizedGet("${apiBase()}/artists?query=${encode(query)}")
        return res.body<ArtistsResponse>().items
    }

    suspend fun artistTracks(name: String): List<TrackDto> {
        val res = authorizedGet("${apiBase()}/artists/${encode(name)}/tracks")
        return res.body<TracksResponse>().items
    }

    suspend fun stats(period: String, year: Int? = null): ListeningStats {
        val tz = java.util.TimeZone.getDefault().id
        val y = year?.let { "&year=$it" } ?: ""
        val res = authorizedGet("${apiBase()}/me/stats?period=$period&tz=${encode(tz)}$y")
        return res.body()
    }

    suspend fun shelves(): HomeShelves {
        val res = authorizedGet("${apiBase()}/me/shelves")
        return res.body()
    }

    suspend fun postPlays(events: List<PlayEvent>) {
        authorizedPost("${apiBase()}/me/plays", PlaysBody(events))
    }

    suspend fun subscription(): UserSubscriptionDto {
        val res = authorizedGet("${apiBase()}/me/subscription")
        return res.body()
    }

    suspend fun activatePromo(code: String) {
        authorizedPost("${apiBase()}/subscription/activate-promo", PromoBody(code))
    }

    suspend fun registerDevice(deviceId: String, name: String) {
        authorizedPost("${apiBase()}/devices/register", RegisterDeviceBody(deviceId, name))
    }

    suspend fun offlinePackageBytes(trackId: String, deviceId: String): ByteArray {
        val session = preferences.loadSession() ?: throw ApiException("Not authenticated")
        var response = http.get("${apiBase()}/tracks/$trackId/offline-package") {
            header(HttpHeaders.Authorization, "Bearer ${session.accessToken}")
            header("X-Device-Id", deviceId)
        }
        if (response.status.value == 401 && refreshAccessToken()) {
            val next = preferences.loadSession() ?: throw ApiException("Not authenticated")
            response = http.get("${apiBase()}/tracks/$trackId/offline-package") {
                header(HttpHeaders.Authorization, "Bearer ${next.accessToken}")
                header("X-Device-Id", deviceId)
            }
        }
        if (!response.status.isSuccess()) throw ApiException(response.bodyAsText())
        return response.body()
    }

    suspend fun listLobbies(): LobbyListDto {
        val res = authorizedGet("${apiBase()}/lobbies")
        return res.body()
    }

    suspend fun createLobby(title: String, isPublic: Boolean = false): LobbyDto {
        val res = authorizedPost("${apiBase()}/lobbies", CreateLobbyBody(title, isPublic = isPublic))
        return res.body()
    }

    suspend fun joinLobby(inviteCode: String): LobbyDto {
        val res = authorizedPost("${apiBase()}/lobbies/join", JoinLobbyBody(inviteCode))
        return res.body()
    }

    suspend fun getLobby(id: String): LobbyDto {
        val res = authorizedGet("${apiBase()}/lobbies/$id")
        return res.body()
    }

    suspend fun leaveLobby(id: String) {
        authorizedPost("${apiBase()}/lobbies/$id/leave", EmptyBody())
    }

    suspend fun deleteLobby(id: String) {
        withAuth { token ->
            http.delete("${apiBase()}/lobbies/$id") { header(HttpHeaders.Authorization, "Bearer $token") }
        }
    }

    suspend fun suggestLobbyTrack(lobbyId: String, track: UnifiedTrack): LobbyQueueItemDto {
        val res = authorizedPost("${apiBase()}/lobbies/$lobbyId/suggestions", SuggestBody(track))
        return res.body()
    }

    suspend fun acceptLobbyItem(lobbyId: String, itemId: String): List<LobbyQueueItemDto> {
        val res = authorizedPost("${apiBase()}/lobbies/$lobbyId/queue/$itemId/accept", EmptyBody())
        return res.body()
    }

    suspend fun rejectLobbyItem(lobbyId: String, itemId: String): List<LobbyQueueItemDto> {
        val res = authorizedPost("${apiBase()}/lobbies/$lobbyId/queue/$itemId/reject", EmptyBody())
        return res.body()
    }

    suspend fun lobbyPlayback(lobbyId: String, action: String, track: UnifiedTrack? = null, positionMs: Long? = null): LobbyPlaybackState {
        val res = authorizedPost("${apiBase()}/lobbies/$lobbyId/playback", PlaybackBody(action, track, positionMs))
        return res.body()
    }

    suspend fun relayUpload(uploadUrl: String, token: String, bearer: String, filename: String, bytes: ByteArray) {
        val res = http.post(uploadUrl) {
            header(HttpHeaders.Authorization, "Bearer $bearer")
            header("X-Relay-Token", token)
            setBody(
                MultiPartFormDataContent(
                    formData {
                        append(
                            "file",
                            bytes,
                            Headers.build {
                                append(HttpHeaders.ContentDisposition, "filename=\"$filename\"")
                            },
                        )
                    },
                ),
            )
        }
        if (!res.status.isSuccess()) throw ApiException(res.bodyAsText())
    }

    suspend fun siteDownloads(): SiteDownloads {
        val res = http.get("${apiBase()}/site/downloads")
        if (!res.status.isSuccess()) throw ApiException(res.bodyAsText())
        return json.decodeFromString(res.bodyAsText())
    }

    private suspend fun authorizedGet(url: String): HttpResponse =
        withAuth { token -> http.get(url) { header(HttpHeaders.Authorization, "Bearer $token") } }

    private suspend fun authorizedPost(url: String, body: Any): HttpResponse =
        withAuth { token ->
            http.post(url) {
                header(HttpHeaders.Authorization, "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(body)
            }
        }

    private suspend fun withAuth(block: suspend (token: String) -> HttpResponse): HttpResponse {
        var session = preferences.loadSession() ?: throw ApiException("Not authenticated")
        var response = block(session.accessToken)
        if (response.status.value == 401 && refreshAccessToken()) {
            session = preferences.loadSession() ?: throw ApiException("Not authenticated")
            response = block(session.accessToken)
        }
        if (!response.status.isSuccess()) throw ApiException(response.bodyAsText())
        return response
    }

    private fun encode(q: String) = java.net.URLEncoder.encode(q, Charsets.UTF_8)

    @Serializable private data class LoginBody(val email: String, val password: String)
    @Serializable private data class VerifyEmailBody(val email: String, val code: String)
    @Serializable private data class AuthErrorBody(val code: String? = null, val email: String? = null, val message: String? = null)
    @Serializable private data class RefreshBody(val refreshToken: String)
    @Serializable private data class RegisterDeviceBody(val deviceId: String, val name: String)
    @Serializable private data class CreatePlaylistBody(val name: String, val description: String? = null)
    @Serializable private data class UpdatePlaylistBody(val name: String? = null, val description: String? = null, val author: String? = null)
    @Serializable private data class AddTrackBody(val trackId: String)
    @Serializable private data class AddExternalBody(val items: List<ExternalItem>)
    @Serializable private data class ExternalItem(val source: String, val externalId: String, val snapshot: SnapshotBody)
    @Serializable private data class SnapshotBody(
        val title: String,
        val artist: String,
        val album: String? = null,
        val coverUrl: String? = null,
        val durationMs: Long? = null,
    )
    @Serializable private data class ReorderBody(val entryIds: List<String>)
    @Serializable private data class EmptyBody(val ok: Boolean = true)
    @Serializable private data class RegisterTrackBody(
        val contentHash: String,
        val title: String,
        val artist: String,
        val album: String? = null,
        val durationMs: Long? = null,
        val sizeBytes: Long,
        val originalFilename: String,
    )
    @Serializable private data class UpdateTrackBody(val title: String? = null, val artist: String? = null, val album: String? = null)
    @Serializable private data class PlaysBody(val events: List<PlayEvent>)
    @Serializable private data class PromoBody(val code: String)
    @Serializable private data class CreateLobbyBody(
        val title: String,
        val maxMembers: Int? = null,
        val isPublic: Boolean = false,
    )
    @Serializable private data class JoinLobbyBody(val inviteCode: String)
    @Serializable private data class SuggestBody(val track: UnifiedTrack)
    @Serializable private data class PlaybackBody(
        val action: String,
        val track: UnifiedTrack? = null,
        val positionMs: Long? = null,
    )
    @Serializable private data class ArtistsResponse(val items: List<CatalogArtistDto> = emptyList())
}

@Serializable
data class SiteDownloads(
    val androidApkUrl: String? = null,
    val version: String? = null,
)

class ApiException(message: String) : Exception(message)

class EmailNotVerifiedException(val email: String, message: String) : Exception(message)
