package com.mss.core.connectors

import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import javax.inject.Inject
import javax.inject.Singleton

enum class AuthStatus { DISCONNECTED, CONNECTED, EXPIRED }

interface StreamConnector {
    val id: SourceId
    val displayName: String
    fun authStatus(): AuthStatus
    suspend fun disconnect()
    suspend fun search(query: String, limit: Int): List<UnifiedTrack>
    suspend fun listPlaylists(): List<UnifiedPlaylist>
    suspend fun savedTracks(limit: Int): List<UnifiedTrack>
    suspend fun resolvePlaybackUrl(track: UnifiedTrack): String
}

@Singleton
class ConnectorRegistry @Inject constructor(
    val spotify: SpotifyConnector,
    val yandex: YandexConnector,
    val vk: VkConnector,
) {
    fun all(): List<StreamConnector> = listOf(spotify, yandex, vk)
    fun get(source: SourceId): StreamConnector? = when (source) {
        SourceId.SPOTIFY -> spotify
        SourceId.YANDEX -> yandex
        SourceId.VK -> vk
        SourceId.LOCAL -> null
    }
}

open class ConnectorException(message: String) : Exception(message)

class VkAuthException(
    message: String,
    val captchaSid: String? = null,
    val captchaImg: String? = null,
    val robot: Boolean = false,
    val passwordRequired: Boolean = false,
    val need2fa: Boolean = false,
    val phoneMask: String? = null,
) : ConnectorException(message)
