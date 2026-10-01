package com.mss.android.ui.navigation

import com.mss.android.ui.LibraryTab
import com.mss.core.model.UnifiedArtist
import com.mss.core.model.UnifiedTrack

data class DeepLinkAction(
    val route: String,
    val playSource: String? = null,
    val playId: String? = null,
    val inviteCode: String? = null,
    val libraryTab: LibraryTab? = null,
)

fun parseMssLink(url: String): DeepLinkAction? {
    val parsed = try {
        java.net.URI(url)
    } catch (_: Exception) {
        return null
    }
    if (parsed.scheme != "mss") return null
    val host = parsed.host?.lowercase() ?: return null
    val parts = parsed.path.orEmpty().trim('/').split('/').filter { it.isNotEmpty() }
        .map { java.net.URLDecoder.decode(it, Charsets.UTF_8) }
    val query = parsed.query
    val codeFromQuery = query?.split('&')?.firstNotNullOfOrNull {
        val kv = it.split('=', limit = 2)
        // Значение в запросе приходит закодированным, в отличие от частей пути.
        if (kv.getOrNull(0) == "code") kv.getOrNull(1)?.let { v -> decodeQuery(v) } else null
    }
    return when (host) {
        "open" -> when (parts.firstOrNull()) {
            "track" -> DeepLinkAction(Routes.HOME, playSource = "local", playId = parts.getOrNull(1))
            "playlist" -> parts.getOrNull(1)?.let { DeepLinkAction(Routes.mssPlaylist(it)) }
            else -> DeepLinkAction(Routes.HOME)
        }
        "track" -> if (parts.size >= 2) DeepLinkAction(Routes.HOME, playSource = parts[0], playId = parts[1]) else null
        "album" -> if (parts.size >= 2) DeepLinkAction(Routes.album(parts[0], parts[1])) else null
        "playlist" -> if (parts.getOrNull(0) == "local" && parts.size >= 2) {
            DeepLinkAction(Routes.mssPlaylist(parts[1]))
        } else if (parts.size >= 2) DeepLinkAction(Routes.playlist(parts[0], parts[1])) else null
        "artist" -> when {
            parts.size >= 3 -> DeepLinkAction(Routes.artist(parts[2], parts[0], parts[1]))
            else -> DeepLinkAction(Routes.artist(parts.firstOrNull() ?: return null))
        }
        "wave" -> DeepLinkAction(Routes.WAVE)
        "search" -> DeepLinkAction(Routes.SEARCH)
        "library" -> DeepLinkAction(
            Routes.LIBRARY,
            libraryTab = when (parts.firstOrNull()) {
                "uploads" -> LibraryTab.UPLOADS
                "downloads", "offline" -> LibraryTab.DOWNLOADS
                "likes" -> LibraryTab.TRACKS
                "playlists" -> LibraryTab.PLAYLISTS
                "artists" -> LibraryTab.ARTISTS
                "albums" -> LibraryTab.ALBUMS
                "history" -> LibraryTab.HISTORY
                else -> null
            },
        )
        "stats" -> DeepLinkAction(if (parts.firstOrNull() == "wrapped") Routes.WRAPPED else Routes.STATS)
        "settings" -> DeepLinkAction(Routes.SETTINGS)
        "lobby" -> DeepLinkAction(Routes.LOBBY, inviteCode = parts.firstOrNull() ?: codeFromQuery)
        "similar" -> if (parts.size >= 2) DeepLinkAction(Routes.similar(parts[0], parts[1])) else null
        "spotify" -> null
        else -> null
    }
}

private fun decodeQuery(value: String): String =
    runCatching { java.net.URLDecoder.decode(value, Charsets.UTF_8) }.getOrDefault(value)

object Routes {
    const val HOME = "home"
    const val SEARCH = "search"
    const val LIBRARY = "library"
    const val MORE = "more"
    const val SETTINGS = "settings"
    const val STATS = "stats"
    const val WRAPPED = "wrapped"
    const val SUBSCRIPTION = "subscription"
    const val WAVE = "wave"
    const val LOBBY = "lobby"
    const val LOBBY_ROOM = "lobby/{id}"
    const val NOW_PLAYING = "nowplaying"
    const val MSS_PLAYLIST = "playlists/{id}"
    const val EXT_PLAYLIST = "playlist/{source}/{id}"
    const val ALBUM = "album/{source}/{id}"
    const val ARTIST = "artist/{source}/{id}/{name}"
    const val SIMILAR = "similar/{source}/{id}"
    const val SOURCE_HOME = "source/{source}"

    fun mssPlaylist(id: String) = "playlists/$id"
    fun playlist(source: String, id: String) = "playlist/$source/${java.net.URLEncoder.encode(id, Charsets.UTF_8)}"
    fun album(source: String, id: String) = "album/$source/${java.net.URLEncoder.encode(id, Charsets.UTF_8)}"
    fun album(track: UnifiedTrack): String {
        val id = track.albumId?.takeIf { it.isNotBlank() } ?: track.album?.takeIf { it.isNotBlank() } ?: "-"
        return album(track.source.name.lowercase(), id)
    }
    fun artist(name: String, source: String = "local", id: String = "-"): String {
        val safeId = id.ifBlank { "-" }
        return "artist/$source/${java.net.URLEncoder.encode(safeId, Charsets.UTF_8)}/${java.net.URLEncoder.encode(name, Charsets.UTF_8)}"
    }

    fun artist(track: UnifiedTrack): String {
        val ref = track.artists?.firstOrNull()
        return artist(ref?.name ?: track.artist, track.source.name.lowercase(), ref?.id ?: "-")
    }

    fun artist(item: UnifiedArtist): String = artist(item.name, item.source.name.lowercase(), item.id)
    fun similar(source: String, id: String) = "similar/$source/${java.net.URLEncoder.encode(id, Charsets.UTF_8)}"
    fun sourceHome(source: String) = "source/$source"
    fun lobbyRoom(id: String) = "lobby/$id"
}
