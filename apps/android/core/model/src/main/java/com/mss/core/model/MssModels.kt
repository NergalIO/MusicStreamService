package com.mss.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class SourceId {
    @SerialName("local") LOCAL,
    @SerialName("spotify") SPOTIFY,
    @SerialName("yandex") YANDEX,
    @SerialName("vk") VK,
}

@Serializable
enum class Quality {
    @SerialName("lossless") LOSSLESS,
    @SerialName("high") HIGH,
    @SerialName("normal") NORMAL,
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
data class PlanFeatures(
    @SerialName("max_offline_tracks") val maxOfflineTracks: Int? = null,
    @SerialName("offline_enabled") val offlineEnabled: Boolean = false,
    @SerialName("stream_quality") val streamQuality: String = "standard",
    @SerialName("external_sources_enabled") val externalSourcesEnabled: Boolean = true,
    val ads: Boolean = false,
)

@Serializable
data class TrackDto(
    val id: String,
    val title: String,
    val artist: String,
    val album: String? = null,
    val albumId: String? = null,
    val durationMs: Long? = null,
    val status: String? = null,
    val codec: String? = null,
    val coverUrl: String? = null,
    val streamUrl: String? = null,
    val contentHash: String? = null,
    val availability: String? = null,
    val userHolds: Boolean? = null,
    val loudnessLufs: Double? = null,
    val cloudPlayUrl: String? = null,
    val cloudDownloadUrl: String? = null,
    val cloudUrlExpiresAt: String? = null,
)

@Serializable
data class TracksResponse(val items: List<TrackDto> = emptyList())

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
data class PlaylistsResponse(val items: List<PlaylistDto> = emptyList())

@Serializable
data class AlbumDto(
    val id: String,
    val title: String,
    val artist: String,
    val year: Int? = null,
    val type: String? = null,
    val coverUrl: String? = null,
    val trackCount: Int = 0,
    val tracks: List<TrackDto> = emptyList(),
)

@Serializable
data class AlbumsResponse(val items: List<AlbumDto> = emptyList())

@Serializable
data class ArtistRef(val id: String, val name: String)

@Serializable
data class ExternalTrackSnapshot(
    val title: String,
    val artist: String,
    val artists: List<ArtistRef>? = null,
    val album: String? = null,
    val albumId: String? = null,
    val durationMs: Long? = null,
    val coverUrl: String? = null,
    val explicit: Boolean? = null,
)

@Serializable
data class ExternalPlaylistRef(
    val source: SourceId,
    val id: String,
    val snapshot: ExternalTrackSnapshot,
)

@Serializable
data class PlaylistEntryDto(
    val entryId: String? = null,
    val position: Int? = null,
    val id: String? = null,
    val title: String? = null,
    val artist: String? = null,
    val album: String? = null,
    val durationMs: Long? = null,
    val status: String? = null,
    val codec: String? = null,
    val coverUrl: String? = null,
    val streamUrl: String? = null,
    val contentHash: String? = null,
    val availability: String? = null,
    val userHolds: Boolean? = null,
    val loudnessLufs: Double? = null,
    val cloudPlayUrl: String? = null,
    val cloudDownloadUrl: String? = null,
    val cloudUrlExpiresAt: String? = null,
    val external: ExternalPlaylistRef? = null,
)

@Serializable
data class PlaylistTracksResponse(val items: List<PlaylistEntryDto> = emptyList())

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
    val loudnessLufs: Double? = null,
    val availability: String? = null,
    val userHolds: Boolean? = null,
    val contentHash: String? = null,
    val cloudPlayUrl: String? = null,
    val cloudDownloadUrl: String? = null,
    val cloudUrlExpiresAt: String? = null,
)

@Serializable
data class UnifiedArtist(
    val source: SourceId,
    val id: String,
    val name: String,
    val imageUrl: String? = null,
    val genres: List<String>? = null,
    val followers: Int? = null,
    val monthlyListeners: Int? = null,
    val description: String? = null,
    val trackCount: Int? = null,
)

fun localArtistLikeId(name: String): String = foldCatalogText(name).take(200)

fun foldCatalogText(value: String): String =
    value.trim().lowercase().replace('ё', 'е').replace(Regex("\\s+"), " ")

fun sameCatalogTrack(a: UnifiedTrack, b: UnifiedTrack): Boolean {
    if (a.id == b.id) return true
    val ha = a.contentHash?.lowercase()
    val hb = b.contentHash?.lowercase()
    if (!ha.isNullOrBlank() && ha == hb) return true
    val durationOk = a.durationMs == null || b.durationMs == null ||
        kotlin.math.abs((a.durationMs ?: 0) - (b.durationMs ?: 0)) <= 8_000
    return foldCatalogText(a.title) == foldCatalogText(b.title) &&
        foldCatalogText(a.artist) == foldCatalogText(b.artist) &&
        durationOk
}

fun rankCatalogTrack(track: UnifiedTrack): Int =
    (if (!track.coverUrl.isNullOrBlank()) 4 else 0) +
        (if (track.userHolds == true) 2 else 0) +
        (if (track.availability == "cached" || track.availability == "online") 1 else 0)

fun dedupeCatalogTracks(tracks: List<UnifiedTrack>): List<UnifiedTrack> {
    val out = mutableListOf<UnifiedTrack>()
    for (track in tracks) {
        val idx = out.indexOfFirst { sameCatalogTrack(it, track) }
        if (idx < 0) out += track
        else if (rankCatalogTrack(track) > rankCatalogTrack(out[idx])) out[idx] = track
    }
    return out
}

@Serializable
data class UnifiedAlbum(
    val source: SourceId,
    val id: String,
    val title: String,
    val artist: String,
    val artists: List<ArtistRef>? = null,
    val year: Int? = null,
    val coverUrl: String? = null,
    val trackCount: Int? = null,
    val type: String? = null,
    val genre: String? = null,
)

@Serializable
data class AlbumWithTracks(
    val source: SourceId,
    val id: String,
    val title: String,
    val artist: String,
    val artists: List<ArtistRef>? = null,
    val year: Int? = null,
    val coverUrl: String? = null,
    val trackCount: Int? = null,
    val type: String? = null,
    val genre: String? = null,
    val tracks: List<UnifiedTrack> = emptyList(),
    val label: String? = null,
    val durationMs: Long? = null,
    val description: String? = null,
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
data class ArtistProfile(
    val artist: UnifiedArtist,
    val popularTracks: List<UnifiedTrack> = emptyList(),
    val albums: List<UnifiedAlbum> = emptyList(),
    val singles: List<UnifiedAlbum> = emptyList(),
    val similar: List<UnifiedArtist> = emptyList(),
)

@Serializable
data class LyricsLine(val timeMs: Long, val text: String)

@Serializable
data class TrackLyrics(
    val synced: Boolean,
    val lines: List<LyricsLine> = emptyList(),
    val writers: List<String>? = null,
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
    val source: SourceId = SourceId.YANDEX,
    val userCode: String,
    val verificationUrl: String,
    val expiresIn: Int,
    val interval: Int = 5,
)

@Serializable
data class FeedItemPlaylist(val kind: String = "playlist", val playlist: UnifiedPlaylist)

@Serializable
data class FeedBlock(
    val id: String,
    val title: String,
    val items: List<FeedItem> = emptyList(),
)

@Serializable
data class FeedItem(
    val kind: String,
    val playlist: UnifiedPlaylist? = null,
    val album: UnifiedAlbum? = null,
    val track: UnifiedTrack? = null,
    val artist: UnifiedArtist? = null,
)

@Serializable
data class HomeFeedSection(
    val id: String,
    val title: String,
    val items: List<FeedItem> = emptyList(),
)

@Serializable
data class WaveBatch(
    val sessionId: String,
    val batchId: String,
    val tracks: List<UnifiedTrack> = emptyList(),
)

@Serializable
data class WaveSettings(
    val seed: String? = null,
    val seedTitle: String? = null,
    val diversity: String? = null,
    val moodEnergy: String? = null,
    val language: String? = null,
)

@Serializable
data class PlaybackReport(
    val trackId: String,
    val albumId: String? = null,
    val trackLengthSeconds: Double,
    val totalPlayedSeconds: Double,
    val endPositionSeconds: Double,
)

@Serializable
data class StatsTopTrack(
    val source: SourceId,
    val trackId: String,
    val title: String,
    val artist: String,
    val artists: List<ArtistRef>? = null,
    val album: String? = null,
    val albumId: String? = null,
    val coverUrl: String? = null,
    val durationMs: Long? = null,
    val plays: Int = 0,
    val minutes: Double = 0.0,
)

@Serializable
data class StatsTopArtist(
    val name: String,
    val id: String? = null,
    val source: SourceId = SourceId.LOCAL,
    val coverUrl: String? = null,
    val plays: Int = 0,
    val minutes: Double = 0.0,
)

@Serializable
data class ListeningHistoryItem(
    val source: SourceId,
    val trackId: String,
    val title: String,
    val artist: String,
    val artists: List<ArtistRef>? = null,
    val album: String? = null,
    val albumId: String? = null,
    val coverUrl: String? = null,
    val durationMs: Long? = null,
    val playedAt: String,
)

@Serializable
data class ListeningHistory(val items: List<ListeningHistoryItem> = emptyList())

@Serializable
data class ListeningStats(
    val period: String,
    val year: Int? = null,
    val totalMinutes: Int = 0,
    val totalPlays: Int = 0,
    val uniqueTracks: Int = 0,
    val uniqueArtists: Int = 0,
    val activeDays: Int = 0,
    val topTracks: List<StatsTopTrack> = emptyList(),
    val topArtists: List<StatsTopArtist> = emptyList(),
    val timeline: List<TimelineBucket> = emptyList(),
    val timelineUnit: String? = null,
    val sources: List<SourceMinutes> = emptyList(),
    val peakHour: Int? = null,
)

@Serializable
data class TimelineBucket(val bucket: String, val minutes: Double = 0.0)

@Serializable
data class SourceMinutes(val source: SourceId, val minutes: Double = 0.0)

@Serializable
data class HomeShelves(
    val frequent: List<StatsTopTrack> = emptyList(),
    val forgotten: List<StatsTopTrack> = emptyList(),
    val topArtists: List<StatsTopArtist> = emptyList(),
)

@Serializable
data class UserSubscriptionDto(
    val planCode: String,
    val planName: String,
    val status: String,
    val endsAt: String? = null,
    val features: PlanFeatures = PlanFeatures(),
)

@Serializable
data class PlayEvent(
    val clientEventId: String,
    val source: SourceId,
    val trackId: String,
    val title: String,
    val artist: String,
    val artists: List<ArtistRef>? = null,
    val album: String? = null,
    val albumId: String? = null,
    val coverUrl: String? = null,
    val durationMs: Long? = null,
    val playedMs: Long,
    val completed: Boolean,
    val playedAt: String,
)

@Serializable
data class DownloadRecord(
    val key: String,
    val path: String,
    val codec: String = "bin",
    val size: Long = 0,
    val downloadedAt: String,
    val track: UnifiedTrack,
)

@Serializable
data class LobbyPlaybackState(
    val track: UnifiedTrack? = null,
    val paused: Boolean = true,
    val positionMs: Long = 0,
    val updatedAt: String? = null,
)

@Serializable
data class LobbyMemberDto(
    val userId: String,
    val role: String,
    val displayName: String? = null,
    val joinedAt: String? = null,
)

@Serializable
data class LobbyQueueItemDto(
    val id: String,
    val position: Int = 0,
    val track: UnifiedTrack,
    val suggestedBy: String? = null,
    val status: String = "suggested",
    val createdAt: String? = null,
)

@Serializable
data class LobbyDto(
    val id: String,
    val inviteCode: String,
    val title: String,
    val maxMembers: Int = 16,
    val isPublic: Boolean = false,
    val hostUserId: String,
    val createdAt: String? = null,
    val endedAt: String? = null,
    val members: List<LobbyMemberDto> = emptyList(),
    val queue: List<LobbyQueueItemDto> = emptyList(),
    val playback: LobbyPlaybackState = LobbyPlaybackState(),
)

@Serializable
data class LobbySummaryDto(
    val id: String,
    val inviteCode: String,
    val title: String,
    val listeners: Int = 0,
    val maxMembers: Int = 16,
    val isPublic: Boolean = false,
    val isMember: Boolean = false,
    val hostUserId: String,
    val hostDisplayName: String? = null,
    val hostOnline: Boolean = false,
    val hostRttMs: Int? = null,
    val hostLossPct: Double? = null,
    val createdAt: String? = null,
)

@Serializable
data class LobbyListDto(
    val items: List<LobbySummaryDto> = emptyList(),
    val tookMs: Double = 0.0,
)

@Serializable
data class CatalogArtistDto(
    val name: String,
    val trackCount: Int = 0,
)

@Serializable
data class LocalHolding(
    val trackId: String,
    val uri: String,
    val contentHash: String,
    val displayName: String? = null,
)

@Serializable
data class PlaybackSettings(
    val quality: Quality = Quality.HIGH,
    val eqEnabled: Boolean = false,
    val eqBands: List<Float> = List(8) { 0f },
    val normalize: Boolean = true,
    val visualizer: Boolean = false,
    val crossfadeMs: Int = 0,
    val playbackRate: Float = 1f,
    val accent: String = "violet",
    /** Тестовая функция: запуск трека Spotify одним запросом к Web API вместо кликов по веб-плееру. */
    val spotifyFastStart: Boolean = true,
)

fun TrackDto.toUnifiedTrack(apiBase: String): UnifiedTrack {
    val base = apiBase.trimEnd('/')
    val stream = streamUrl?.let { if (it.startsWith("http")) it else "$base/${it.trimStart('/')}" }
        ?: if (availability == "cached" || availability == "online") "$base/stream/$id" else null
    return UnifiedTrack(
        source = SourceId.LOCAL,
        id = id,
        title = title,
        artist = artist,
        album = album,
        albumId = albumId,
        durationMs = durationMs,
        coverUrl = coverUrl,
        playable = when (status) {
            "processing", "uploading", "failed" -> false
            else -> stream != null || userHolds == true || freshCloudUrl(cloudPlayUrl, cloudUrlExpiresAt) != null
        },
        unplayableReason = when (status) {
            "processing" -> "Трек ещё обрабатывается"
            "uploading" -> "Файл загружается в облако"
            "failed" -> "Не удалось обработать файл"
            else -> null
        },
        streamUrl = stream,
        loudnessLufs = loudnessLufs,
        availability = availability,
        userHolds = userHolds,
        contentHash = contentHash,
        cloudPlayUrl = cloudPlayUrl,
        cloudDownloadUrl = cloudDownloadUrl,
        cloudUrlExpiresAt = cloudUrlExpiresAt,
    )
}

fun PlaylistEntryDto.toUnifiedTrack(apiBase: String): UnifiedTrack? {
    val ext = external
    if (ext != null) {
        val snap = ext.snapshot
        return UnifiedTrack(
            source = ext.source,
            id = ext.id,
            title = snap.title,
            artist = snap.artist,
            artists = snap.artists,
            album = snap.album,
            albumId = snap.albumId,
            durationMs = snap.durationMs,
            coverUrl = snap.coverUrl,
            explicit = snap.explicit,
            playable = true,
        )
    }
    val localId = id ?: return null
    return TrackDto(
        id = localId,
        title = title ?: return null,
        artist = artist ?: "",
        album = album,
        albumId = null,
        durationMs = durationMs,
        status = status,
        codec = codec,
        coverUrl = coverUrl,
        streamUrl = streamUrl,
        contentHash = contentHash,
        availability = availability,
        userHolds = userHolds,
        loudnessLufs = loudnessLufs,
        cloudPlayUrl = cloudPlayUrl,
        cloudDownloadUrl = cloudDownloadUrl,
        cloudUrlExpiresAt = cloudUrlExpiresAt,
    ).toUnifiedTrack(apiBase)
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

fun AlbumDto.toUnifiedAlbum(): UnifiedAlbum = UnifiedAlbum(
    source = SourceId.LOCAL,
    id = id,
    title = title,
    artist = artist,
    year = year,
    coverUrl = coverUrl,
    trackCount = trackCount,
    type = type,
)

fun AlbumDto.toAlbumWithTracks(apiBase: String): AlbumWithTracks {
    val mapped = dedupeCatalogTracks(
        tracks.map { dto ->
            val unified = dto.toUnifiedTrack(apiBase)
            unified.copy(
                albumId = dto.albumId ?: id,
                album = dto.album ?: title,
                coverUrl = unified.coverUrl ?: coverUrl,
            )
        },
    )
    return AlbumWithTracks(
        source = SourceId.LOCAL,
        id = id,
        title = title,
        artist = artist,
        year = year,
        coverUrl = coverUrl,
        trackCount = mapped.size,
        type = type,
        tracks = mapped,
        durationMs = mapped.mapNotNull { it.durationMs }.sum().takeIf { it > 0 },
    )
}

fun AlbumWithTracks.toUnifiedAlbum(): UnifiedAlbum = UnifiedAlbum(
    source = source,
    id = id,
    title = title,
    artist = artist,
    artists = artists,
    year = year,
    coverUrl = coverUrl,
    trackCount = trackCount,
    type = type,
    genre = genre,
)

fun ListeningHistoryItem.toUnifiedTrack(): UnifiedTrack = UnifiedTrack(
    source = source,
    id = trackId,
    title = title,
    artist = artist,
    artists = artists,
    album = album,
    albumId = albumId,
    coverUrl = coverUrl,
    durationMs = durationMs,
    playable = true,
)

fun StatsTopTrack.toUnifiedTrack(): UnifiedTrack = UnifiedTrack(
    source = source,
    id = trackId,
    title = title,
    artist = artist,
    artists = artists,
    album = album,
    albumId = albumId,
    coverUrl = coverUrl,
    durationMs = durationMs,
    playable = true,
)

fun parseLrc(lrc: String): List<LyricsLine> {
    val stamp = Regex("""\[(\d+):(\d+(?:\.\d+)?)]""")
    val lines = mutableListOf<LyricsLine>()
    for (raw in lrc.split(Regex("\\r?\\n"))) {
        val stamps = stamp.findAll(raw).toList()
        if (stamps.isEmpty()) continue
        val text = raw.replace(Regex("""\[[^\]]*\]"""), "").trim()
        for (s in stamps) {
            val ms = Math.round((s.groupValues[1].toDouble() * 60 + s.groupValues[2].toDouble()) * 1000)
            lines += LyricsLine(ms, text)
        }
    }
    return lines.sortedBy { it.timeMs }
}

fun lyricsToSidecar(lyrics: TrackLyrics?): Pair<String, String>? {
    if (lyrics == null || lyrics.lines.none { it.text.isNotBlank() }) return null
    return if (lyrics.synced && lyrics.lines.any { it.timeMs >= 0 }) {
        val text = lyrics.lines.joinToString("\n") { line ->
            val ms = line.timeMs.coerceAtLeast(0)
            val m = ms / 60_000
            val s = (ms % 60_000) / 1000.0
            String.format(java.util.Locale.US, "[%02d:%05.2f]%s", m, s, line.text)
        }
        "lrc" to text
    } else {
        "txt" to lyrics.lines.joinToString("\n") { it.text }
    }
}

fun lyricsFromSidecarFile(audioPath: String): TrackLyrics? {
    val base = audioPath.substringBeforeLast('.')
    val lrc = java.io.File("$base.lrc")
    if (lrc.isFile) {
        val lines = parseLrc(lrc.readText())
        if (lines.isNotEmpty()) return TrackLyrics(synced = true, lines = lines)
    }
    val txt = java.io.File("$base.txt")
    if (txt.isFile) {
        val lines = txt.readText().split(Regex("\\r?\\n")).map { LyricsLine(-1, it) }
        if (lines.any { it.text.isNotBlank() }) return TrackLyrics(synced = false, lines = lines)
    }
    return null
}

fun sourceFrom(raw: String?): SourceId = when (raw?.lowercase()) {
    "spotify" -> SourceId.SPOTIFY
    "yandex" -> SourceId.YANDEX
    "vk" -> SourceId.VK
    else -> SourceId.LOCAL
}

fun freshCloudUrl(url: String?, expiresAt: String?, skewMs: Long = 60_000): String? {
    if (url.isNullOrBlank() || expiresAt.isNullOrBlank()) return null
    val t = runCatching { java.time.Instant.parse(expiresAt).toEpochMilli() }.getOrNull() ?: return null
    return if (t > System.currentTimeMillis() + skewMs) url else null
}

fun audioContentType(filename: String): String = when (filename.substringAfterLast('.', "").lowercase()) {
    "mp3" -> "audio/mpeg"
    "flac" -> "audio/flac"
    "m4a", "aac" -> "audio/mp4"
    "ogg", "oga", "opus" -> "audio/ogg"
    "wav" -> "audio/wav"
    "webm" -> "audio/webm"
    "aif", "aiff" -> "audio/aiff"
    else -> "application/octet-stream"
}
