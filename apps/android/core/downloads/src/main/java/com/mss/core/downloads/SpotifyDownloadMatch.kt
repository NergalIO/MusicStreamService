package com.mss.core.downloads

import com.mss.core.model.UnifiedTrack

/**
 * Spotify не отдаёт файлы (Widevine). Как на ПК: качаем копию из Яндекса/VK,
 * сверяя название, исполнителя и длительность.
 */
object SpotifyDownloadMatch {
    fun key(s: String): String =
        s.lowercase()
            .replace('ё', 'е')
            .replace(Regex("\\s*[\\[(].*?[)\\]]"), "")
            .replace(Regex("\\s+-\\s+.*$"), "")
            .replace(Regex("\\s(feat|ft)\\.?\\s.*$", RegexOption.IGNORE_CASE), "")
            .replace(Regex("[^\\p{L}\\p{N}]+"), " ")
            .trim()

    fun searchQuery(track: UnifiedTrack): String {
        val mainArtist = track.artists?.firstOrNull()?.name ?: track.artist.split(',')[0]
        val plainTitle = track.title.replace(Regex("\\s*[\\[(].*?[)\\]]"), "").replace(Regex("\\s+-\\s+.*$"), "")
        return "$mainArtist $plainTitle".trim()
    }

    fun isCopy(original: UnifiedTrack, candidate: UnifiedTrack): Boolean {
        if (!candidate.playable) return false
        val title = key(original.title)
        val mainArtist = original.artists?.firstOrNull()?.name ?: original.artist.split(',')[0]
        val artist = key(mainArtist)
        if (key(candidate.title) != title) return false
        if (!key(candidate.artist).contains(artist)) return false
        val a = original.durationMs
        val b = candidate.durationMs
        return a == null || b == null || kotlin.math.abs(a - b) <= 5_000
    }

    fun isDirectFileUrl(url: String): Boolean = ".m3u8" !in url.lowercase()
}
