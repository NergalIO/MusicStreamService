package com.mss.core.network

import com.mss.core.datastore.MssPreferences
import com.mss.core.model.AlbumDto
import com.mss.core.model.AlbumsResponse
import com.mss.core.model.AuthSession
import com.mss.core.model.HomeShelves
import com.mss.core.model.ListeningHistory
import com.mss.core.model.ListeningHistoryItem
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
import com.mss.core.model.TrackLyrics
import com.mss.core.model.TracksResponse
import com.mss.core.model.CatalogArtistDto
import com.mss.core.model.SourceId
import com.mss.core.model.ArtistRef
import com.mss.core.model.UnifiedAlbum
import com.mss.core.model.UnifiedArtist
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
import io.ktor.client.statement.readRawBytes
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okio.BufferedSink
import okio.source

@OptIn(ExperimentalSerializationApi::class)
@Singleton
class MssApiClient @Inject constructor(
    private val preferences: MssPreferences,
) {
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
        encodeDefaults = true
        // null в JSON для optional-полей Zod читает как ошибку («expected number, received null»).
        explicitNulls = false
    }
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
        val pending = runCatching { json.decodeFromString<RegisterPending>(text) }.getOrNull()
        if (pending != null && pending.needsVerification && pending.email.isNotBlank()) {
            throw EmailNotVerifiedException(pending.email, "Код отправлен на ${pending.email}")
        }
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

    suspend fun refreshAccessToken(): Boolean = refreshSession() == true

    /** true — обновили, false — сервер отверг refresh token, null — до сервера не достучались. */
    private suspend fun refreshSession(): Boolean? = refreshMutex.withLock {
        val session = preferences.loadSession() ?: return false
        if (session.accessToken == "preview") return true
        val base = apiBase()
        val res = runCatching {
            http.post("$base/auth/refresh") {
                contentType(ContentType.Application.Json)
                setBody(RefreshBody(session.refreshToken))
            }
        }.getOrElse { return null }
        if (!res.status.isSuccess()) return false
        val data = runCatching { res.body<RefreshResponse>() }.getOrElse { return false }
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

    suspend fun likedAlbums(): List<UnifiedAlbum> {
        val res = authorizedGet("${apiBase()}/me/liked-albums")
        return res.body<LikedAlbumsResponse>().items
    }

    suspend fun likeAlbum(album: UnifiedAlbum) {
        authorizedPost(
            "${apiBase()}/likes/albums",
            AlbumLikeBody(
                source = album.source,
                id = album.id,
                title = album.title.ifBlank { "Альбом" },
                artist = album.artist.ifBlank { "Неизвестный исполнитель" },
                year = album.year?.takeIf { it in 1000..2100 },
                type = album.type,
                coverUrl = album.coverUrl?.take(2000),
                trackCount = album.trackCount,
                genre = album.genre,
                artists = album.artists,
            ),
        )
    }

    suspend fun unlikeAlbum(source: SourceId, id: String) {
        withAuth { token ->
            http.delete("${apiBase()}/likes/albums/${source.name.lowercase()}/${encode(id)}") {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
        }
    }

    suspend fun likedArtists(): List<UnifiedArtist> {
        val res = authorizedGet("${apiBase()}/me/liked-artists")
        return res.body<LikedArtistsResponse>().items
    }

    suspend fun likeArtist(artist: UnifiedArtist) {
        authorizedPost(
            "${apiBase()}/likes/artists",
            ArtistLikeBody(
                source = artist.source,
                id = if (artist.source == SourceId.LOCAL) {
                    com.mss.core.model.localArtistLikeId(artist.name)
                } else {
                    artist.id
                },
                name = artist.name.ifBlank { "Исполнитель" },
                imageUrl = artist.imageUrl?.take(2000),
                genres = artist.genres,
                trackCount = artist.trackCount,
            ),
        )
    }

    suspend fun unlikeArtist(source: SourceId, id: String) {
        withAuth { token ->
            http.delete("${apiBase()}/likes/artists/${source.name.lowercase()}/${encode(id)}") {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
        }
    }

    suspend fun myUploads(): List<TrackDto> {
        val res = authorizedGet("${apiBase()}/me/uploads")
        return res.body<TracksResponse>().items
    }

    suspend fun listAlbums(query: String = ""): List<AlbumDto> {
        val q = if (query.isBlank()) "" else "?query=${encode(query)}"
        val res = authorizedGet("${apiBase()}/albums$q")
        return res.body<AlbumsResponse>().items
    }

    suspend fun getAlbum(id: String): AlbumDto {
        val res = authorizedGet("${apiBase()}/albums/$id")
        return res.body()
    }

    suspend fun createAlbum(title: String, artist: String, trackIds: List<String>, year: Int? = null): AlbumDto {
        val res = authorizedPost("${apiBase()}/albums", CreateAlbumBody(title, artist, year, trackIds))
        return res.body()
    }

    suspend fun deleteAlbum(id: String) {
        withAuth { token ->
            http.delete("${apiBase()}/albums/$id") { header(HttpHeaders.Authorization, "Bearer $token") }
        }
    }

    suspend fun putAlbumCover(id: String, bytes: ByteArray, mime: String): AlbumDto {
        val res = withAuth { token ->
            http.put("${apiBase()}/albums/$id/cover") {
                header(HttpHeaders.Authorization, "Bearer $token")
                setBody(
                    MultiPartFormDataContent(
                        formData {
                            append(
                                "file",
                                bytes,
                                Headers.build {
                                    append(HttpHeaders.ContentType, mime)
                                    append(HttpHeaders.ContentDisposition, "filename=\"cover.jpg\"")
                                },
                            )
                        },
                    ),
                )
            }
        }
        return res.body()
    }

    suspend fun putTrackCover(id: String, jpeg: ByteArray): TrackDto {
        val res = withAuth { token ->
            http.put("${apiBase()}/tracks/$id/cover") {
                header(HttpHeaders.Authorization, "Bearer $token")
                setBody(
                    MultiPartFormDataContent(
                        formData {
                            append(
                                "file",
                                jpeg,
                                Headers.build {
                                    append(HttpHeaders.ContentType, "image/jpeg")
                                    append(HttpHeaders.ContentDisposition, "filename=\"cover.jpg\"")
                                },
                            )
                        },
                    ),
                )
            }
        }
        return res.body()
    }

    suspend fun downloadBytes(url: String): ByteArray? {
        val res = runCatching {
            http.get(url) {
                header(
                    HttpHeaders.UserAgent,
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
                )
                header(HttpHeaders.Accept, "image/avif,image/webp,image/*,*/*;q=0.8")
                if (url.contains("scdn.co") || url.contains("spotifycdn.com") || url.contains("spotify.com")) {
                    header(HttpHeaders.Referrer, "https://open.spotify.com/")
                }
            }
        }.getOrNull() ?: return null
        if (!res.status.isSuccess()) return null
        val bytes = runCatching { res.readRawBytes() }.getOrNull() ?: return null
        return bytes.takeIf { it.size in 64..(10 * 1024 * 1024) }
    }

    suspend fun registerTrack(
        contentHash: String,
        title: String,
        artist: String,
        album: String?,
        durationMs: Long?,
        sizeBytes: Long,
        originalFilename: String,
        albumId: String? = null,
    ): TrackDto {
        val qs = albumId?.let { "?albumId=$it" }.orEmpty()
        val res = authorizedPost(
            "${apiBase()}/tracks/register$qs",
            RegisterTrackBody(contentHash, title, artist, album, durationMs, sizeBytes, originalFilename),
        )
        return res.body()
    }

    suspend fun putTrackLyrics(trackId: String, format: String, text: String) {
        withAuth { token ->
            http.put("${apiBase()}/tracks/$trackId/lyrics") {
                header(HttpHeaders.Authorization, "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(LyricsBody(format, text))
            }
        }
    }

    suspend fun trackLyrics(trackId: String): TrackLyrics? {
        val res = runCatching { http.get("${apiBase()}/tracks/$trackId/lyrics") }.getOrNull() ?: return null
        if (res.status.value == 404 || !res.status.isSuccess()) return null
        return runCatching { json.decodeFromString<TrackLyrics>(res.bodyAsText()) }.getOrNull()
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

    suspend fun searchArtists(query: String, limit: Int = 40): List<CatalogArtistDto> {
        val q = buildString {
            append("?limit=$limit")
            if (query.isNotBlank()) append("&query=${encode(query)}")
        }
        val res = authorizedGet("${apiBase()}/artists$q")
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

    suspend fun listeningHistory(): List<ListeningHistoryItem> {
        val res = authorizedGet("${apiBase()}/me/history")
        return res.body<ListeningHistory>().items
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

    suspend fun cloudUpload(trackId: String, contentType: String): CloudUploadResponse {
        val res = authorizedPost("${apiBase()}/tracks/$trackId/cloud-upload", CloudUploadBody(contentType))
        return json.decodeFromString(res.bodyAsText())
    }

    suspend fun cloudComplete(trackId: String): TrackDto {
        val res = authorizedPost("${apiBase()}/tracks/$trackId/cloud-complete", EmptyBody())
        return json.decodeFromString(res.bodyAsText())
    }

    suspend fun putToUrl(url: String, contentType: String, contentLength: Long, body: java.io.InputStream) {
        withContext(Dispatchers.IO) {
            val req = Request.Builder()
                .url(url)
                .put(StreamRequestBody(contentType.toMediaType(), contentLength, body))
                .header("Content-Type", contentType)
                .build()
            val client = OkHttpClient.Builder()
                .retryOnConnectionFailure(false)
                .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
                .writeTimeout(0, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(0, java.util.concurrent.TimeUnit.SECONDS)
                .build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) {
                    throw ApiException(res.body?.string()?.ifBlank { null } ?: "Загрузка: HTTP ${res.code}")
                }
            }
        }
    }

    suspend fun trackDownloadUrl(trackId: String): String {
        val res = withAuth { token ->
            http.get("${apiBase()}/tracks/$trackId/download") {
                header(HttpHeaders.Authorization, "Bearer $token")
                header(HttpHeaders.Accept, "application/json")
            }
        }
        return json.decodeFromString<DownloadUrlBody>(res.bodyAsText()).url
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
        if (response.status.value == 401) {
            val refreshed = refreshSession()
            if (refreshed != true) {
                // Сервер отверг refresh token — сессии больше нет. При обрыве связи аккаунт сохраняем.
                if (refreshed == false && session.accessToken != "preview") preferences.clearSession()
                throw ApiException(
                    if (refreshed == false) "Сессия истекла — войдите снова" else "Нет связи с сервером",
                )
            }
            session = preferences.loadSession() ?: throw ApiException("Not authenticated")
            response = block(session.accessToken)
        }
        if (!response.status.isSuccess()) throw ApiException(apiErrorMessage(response.bodyAsText()))
        return response
    }

    private fun apiErrorMessage(text: String): String {
        val parsed = runCatching { json.decodeFromString<AuthErrorBody>(text) }.getOrNull()
        return parsed?.message?.takeIf { it.isNotBlank() } ?: text
    }

    private fun encode(q: String) = java.net.URLEncoder.encode(q, Charsets.UTF_8)

    @Serializable private data class LoginBody(val email: String, val password: String)
    @Serializable private data class VerifyEmailBody(val email: String, val code: String)
    @Serializable private data class AuthErrorBody(val code: String? = null, val email: String? = null, val message: String? = null)
    @Serializable private data class RefreshBody(val refreshToken: String)
    @Serializable private data class RegisterDeviceBody(val deviceId: String, val name: String)
    @Serializable private data class CreatePlaylistBody(val name: String, val description: String? = null)
    @Serializable private data class CreateAlbumBody(
        val title: String,
        val artist: String,
        val year: Int? = null,
        val trackIds: List<String> = emptyList(),
    )
    @Serializable private data class AlbumLikeBody(
        val source: SourceId,
        val id: String,
        val title: String,
        val artist: String,
        val year: Int? = null,
        val type: String? = null,
        val coverUrl: String? = null,
        val trackCount: Int? = null,
        val genre: String? = null,
        val artists: List<ArtistRef>? = null,
    )
    @Serializable private data class LikedAlbumsResponse(val items: List<UnifiedAlbum> = emptyList())
    @Serializable private data class ArtistLikeBody(
        val source: SourceId,
        val id: String,
        val name: String,
        val imageUrl: String? = null,
        val genres: List<String>? = null,
        val trackCount: Int? = null,
    )
    @Serializable private data class LikedArtistsResponse(val items: List<UnifiedArtist> = emptyList())
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
    @Serializable private data class CloudUploadBody(val contentType: String)
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
    @Serializable private data class LyricsBody(val format: String, val text: String)
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
    @Serializable private data class DownloadUrlBody(val url: String)
}

@Serializable
data class SiteDownloads(
    val androidApk: SiteDownload? = null,
    val release: SiteRelease? = null,
) {
    /** Версия из тега релиза: v0.8.4 → 0.8.4. */
    val version: String? get() = release?.tag?.removePrefix("v")?.removePrefix("V")?.takeIf { it.isNotBlank() }
    val androidApkUrl: String? get() = androidApk?.href?.takeIf { androidApk.available }
}

@Serializable
data class SiteDownload(
    val available: Boolean = false,
    val href: String? = null,
    val fileName: String? = null,
)

@Serializable
data class SiteRelease(
    val tag: String? = null,
    val githubReleasePage: String? = null,
)

class ApiException(message: String) : Exception(message)

class EmailNotVerifiedException(val email: String, message: String) : Exception(message)

@Serializable
data class CloudUploadResponse(
    val skipUpload: Boolean = false,
    val alreadyReady: Boolean = false,
    val uploadUrl: String? = null,
    val headers: Map<String, String>? = null,
    val cloudPlayUrl: String? = null,
    val cloudDownloadUrl: String? = null,
    val cloudUrlExpiresAt: String? = null,
    val status: String? = null,
    val coverUrl: String? = null,
    val title: String? = null,
    val artist: String? = null,
)

private class StreamRequestBody(
    private val media: okhttp3.MediaType,
    private val length: Long,
    private val input: java.io.InputStream,
) : RequestBody() {
    override fun contentType() = media
    override fun contentLength() = length
    override fun writeTo(sink: BufferedSink) {
        input.source().use { source -> sink.writeAll(source) }
    }
}
