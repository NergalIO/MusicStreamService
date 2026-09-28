package com.mss.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class SourceId {
    @SerialName("local") LOCAL,
    @SerialName("spotify") SPOTIFY,
    @SerialName("yandex") YANDEX,
}

@Serializable
data class AuthSession(
    val accessToken: String,
    val refreshToken: String,
    val user: AuthUser,
)

@Serializable
data class AuthUser(val id: String, val email: String)

@Serializable
data class RegisterPending(
    val needsVerification: Boolean = true,
    val email: String,
)

@Serializable
data class RefreshResponse(val accessToken: String)

@Serializable
data class TrackDto(
    val id: String,
    val title: String,
    val artist: String,
    val album: String? = null,
    val durationMs: Long? = null,
    val status: String? = null,
    val codec: String? = null,
    val coverUrl: String? = null,
    val streamUrl: String? = null,
    val availability: String? = null,
    val loudnessLufs: Double? = null,
)

@Serializable
data class TracksResponse(val items: List<TrackDto>)

@Serializable
data class PlaylistDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val author: String? = null,
    val coverUrl: String? = null,
    val trackCount: Int = 0,
)

@Serializable
data class PlaylistsResponse(val items: List<PlaylistDto>)

@Serializable
data class ArtistRef(val id: String, val name: String)

@Serializable
data class UnifiedTrack(
    val source: SourceId,
    val id: String,
    val title: String,
    val artist: String,
    val artists: List<ArtistRef>? = null,
    val album: String? = null,
    val albumId: String? = null,
    val durationMs: Long? = null,
    val coverUrl: String? = null,
    val explicit: Boolean? = null,
    val playable: Boolean = true,
    val unplayableReason: String? = null,
    val streamUrl: String? = null,
)

@Serializable
data class UnifiedArtist(
    val source: SourceId,
    val id: String,
    val name: String,
    val imageUrl: String? = null,
    val genres: List<String>? = null,
    val followers: Int? = null,
)

@Serializable
data class UnifiedPlaylist(
    val source: SourceId,
    val id: String,
    val title: String,
    val owner: String? = null,
    val description: String? = null,
    val coverUrl: String? = null,
    val trackCount: Int? = null,
)

@Serializable
data class PlaylistWithTracks(
    val source: SourceId,
    val id: String,
    val title: String,
    val owner: String? = null,
    val description: String? = null,
    val coverUrl: String? = null,
    val trackCount: Int? = null,
    val tracks: List<UnifiedTrack> = emptyList(),
)

@Serializable
data class ExternalAccount(
    val uid: String,
    val login: String? = null,
    val displayName: String? = null,
    val hasPlus: Boolean? = null,
)

@Serializable
data class DeviceCodePrompt(
    val userCode: String,
    val verificationUrl: String,
    val expiresIn: Int,
    val interval: Int,
)

@Serializable
data class PlaybackHandleMediaUrl(
    val kind: String = "mediaUrl",
    val url: String,
    val preview: Boolean? = null,
    val codec: String? = null,
    val bitrate: Int? = null,
)

@Serializable
data class PlaybackHandleSpotifySdk(
    val kind: String = "spotifySdk",
    val trackUri: String,
    val previewUrl: String? = null,
)

@Serializable
data class UserSubscriptionDto(
    val planCode: String,
    val planName: String,
    val status: String,
    val endsAt: String? = null,
)

@Serializable
data class ListeningStats(
    val period: String,
    val totalMinutes: Int = 0,
    val totalPlays: Int = 0,
    val topTracks: List<StatsTopTrack> = emptyList(),
    val topArtists: List<StatsTopArtist> = emptyList(),
)

@Serializable
data class StatsTopTrack(
    val source: SourceId,
    val trackId: String,
    val title: String,
    val artist: String,
    val coverUrl: String? = null,
    val plays: Int = 0,
)

@Serializable
data class StatsTopArtist(
    val name: String,
    val id: String? = null,
    val source: SourceId,
    val coverUrl: String? = null,
    val plays: Int = 0,
)

fun TrackDto.toUnifiedTrack(apiBase: String): UnifiedTrack {
    val base = apiBase.trimEnd('/')
    val stream = streamUrl?.let { if (it.startsWith("http")) it else "$base/${it.trimStart('/')}" }
        ?: "$base/stream/$id"
    return UnifiedTrack(
        source = SourceId.LOCAL,
        id = id,
        title = title,
        artist = artist,
        album = album,
        durationMs = durationMs,
        coverUrl = coverUrl,
        playable = streamUrl != null,
        streamUrl = stream,
    )
}

fun PlaylistDto.toUnifiedPlaylist(): UnifiedPlaylist = UnifiedPlaylist(
    source = SourceId.LOCAL,
    id = id,
    title = name,
    owner = author,
    description = description,
    coverUrl = coverUrl,
    trackCount = trackCount,
)
