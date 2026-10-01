package com.mss.core.downloads

import com.mss.core.model.ArtistRef
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedTrack
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpotifyDownloadMatchTest {
    @Test
    fun stripsFeatAndParens() {
        assertEquals("love", SpotifyDownloadMatch.key("Love (feat. Someone) - Radio Edit"))
        assertEquals("love", SpotifyDownloadMatch.key("Love ft. Someone"))
    }

    @Test
    fun searchUsesMainArtistAndPlainTitle() {
        val track = UnifiedTrack(
            source = SourceId.SPOTIFY,
            id = "1",
            title = "Song (Remastered)",
            artist = "Band, Other",
            artists = listOf(ArtistRef("a", "Band"), ArtistRef("b", "Other")),
        )
        assertEquals("Band Song", SpotifyDownloadMatch.searchQuery(track))
    }

    @Test
    fun matchesSameTitleArtistDuration() {
        val original = UnifiedTrack(SourceId.SPOTIFY, "s", "Love", "Нервы", durationMs = 180_000)
        val yandex = UnifiedTrack(SourceId.YANDEX, "y", "Love", "Нервы", durationMs = 182_000)
        assertTrue(SpotifyDownloadMatch.isCopy(original, yandex))
    }

    @Test
    fun rejectsDifferentTitle() {
        val original = UnifiedTrack(SourceId.SPOTIFY, "s", "Love", "Нервы", durationMs = 180_000)
        val other = UnifiedTrack(SourceId.YANDEX, "y", "Hate", "Нервы", durationMs = 180_000)
        assertFalse(SpotifyDownloadMatch.isCopy(original, other))
    }

    @Test
    fun rejectsHlsUrl() {
        assertFalse(SpotifyDownloadMatch.isDirectFileUrl("https://vk.com/audio.m3u8?id=1"))
        assertTrue(SpotifyDownloadMatch.isDirectFileUrl("https://yandex.ru/get-mp3/file.mp3"))
    }
}
