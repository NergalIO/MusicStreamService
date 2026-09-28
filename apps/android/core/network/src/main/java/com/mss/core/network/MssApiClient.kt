package com.mss.core.network

import com.mss.core.datastore.MssPreferences
import com.mss.core.model.AuthSession
import com.mss.core.model.RegisterPending
import com.mss.core.model.ListeningStats
import com.mss.core.model.PlaylistDto
import com.mss.core.model.PlaylistsResponse
import com.mss.core.model.RefreshResponse
import com.mss.core.model.TrackDto
import com.mss.core.model.TracksResponse
import com.mss.core.model.UserSubscriptionDto
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
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
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val refreshMutex = Mutex()

    private val http = HttpClient(OkHttp) {
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

    suspend fun searchTracks(query: String, limit: Int = 50): List<TrackDto> {
        val base = apiBase()
        val res = authorizedGet("$base/tracks?query=${encode(query)}&limit=$limit")
        return res.body<TracksResponse>().items
    }

    suspend fun listPlaylists(): List<PlaylistDto> {
        val base = apiBase()
        val res = authorizedGet("$base/playlists")
        return res.body<PlaylistsResponse>().items
    }

    suspend fun playlistTracks(playlistId: String): List<TrackDto> {
        val base = apiBase()
        val res = authorizedGet("$base/playlists/$playlistId/tracks")
        return res.body<PlaylistTracksResponse>().items.mapNotNull { row ->
            row.id?.let {
                TrackDto(
                    id = it,
                    title = row.title ?: return@mapNotNull null,
                    artist = row.artist ?: "",
                    album = row.album,
                    durationMs = row.durationMs,
                    coverUrl = row.coverUrl,
                    streamUrl = row.streamUrl,
                )
            }
        }
    }

    suspend fun likedTracks(): List<TrackDto> {
        val base = apiBase()
        val res = authorizedGet("$base/me/likes")
        return res.body<TracksResponse>().items
    }

    suspend fun stats(period: String): ListeningStats {
        val base = apiBase()
        val res = authorizedGet("$base/me/stats?period=$period")
        return res.body<ListeningStats>()
    }

    suspend fun subscription(): UserSubscriptionDto {
        val base = apiBase()
        val res = authorizedGet("$base/me/subscription")
        return res.body<UserSubscriptionDto>()
    }

    suspend fun registerDevice(deviceId: String, name: String) {
        val base = apiBase()
        authorizedPost("$base/devices/register", RegisterDeviceBody(deviceId, name))
    }

    suspend fun offlinePackageBytes(trackId: String, deviceId: String): ByteArray {
        val base = apiBase()
        val session = preferences.loadSession() ?: throw ApiException("Not authenticated")
        var response = http.get("$base/tracks/$trackId/offline-package") {
            header("Authorization", "Bearer ${session.accessToken}")
            header("X-Device-Id", deviceId)
        }
        if (response.status.value == 401 && refreshAccessToken()) {
            val next = preferences.loadSession() ?: throw ApiException("Not authenticated")
            response = http.get("$base/tracks/$trackId/offline-package") {
                header("Authorization", "Bearer ${next.accessToken}")
                header("X-Device-Id", deviceId)
            }
        }
        if (!response.status.isSuccess()) throw ApiException(response.bodyAsText())
        return response.body()
    }

    private suspend fun authorizedGet(url: String): io.ktor.client.statement.HttpResponse =
        withAuth { token -> http.get(url) { header("Authorization", "Bearer $token") } }

    private suspend fun authorizedPost(url: String, body: Any): io.ktor.client.statement.HttpResponse =
        withAuth { token ->
            http.post(url) {
                header("Authorization", "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody(body)
            }
        }

    private suspend fun withAuth(
        block: suspend (token: String) -> io.ktor.client.statement.HttpResponse,
    ): io.ktor.client.statement.HttpResponse {
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

    @Serializable
    private data class LoginBody(val email: String, val password: String)

    @Serializable
    private data class VerifyEmailBody(val email: String, val code: String)

    @Serializable
    private data class AuthErrorBody(
        val code: String? = null,
        val email: String? = null,
        val message: String? = null,
    )

    @Serializable
    private data class RefreshBody(val refreshToken: String)

    @Serializable
    private data class RegisterDeviceBody(val deviceId: String, val name: String)

    @Serializable
    private data class PlaylistTracksResponse(val items: List<PlaylistTrackRow>)

    @Serializable
    private data class PlaylistTrackRow(
        val id: String? = null,
        val title: String? = null,
        val artist: String? = null,
        val album: String? = null,
        val durationMs: Long? = null,
        val coverUrl: String? = null,
        val streamUrl: String? = null,
    )
}

class ApiException(message: String) : Exception(message)

class EmailNotVerifiedException(val email: String, message: String) : Exception(message)
