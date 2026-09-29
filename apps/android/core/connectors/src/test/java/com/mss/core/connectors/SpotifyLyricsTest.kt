package com.mss.core.connectors

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpotifyLyricsTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun mapsLineSyncedLyrics() {
        val raw = """
            {"lyrics":{"syncType":"LINE_SYNCED","lines":[
              {"startTimeMs":"0","words":""},
              {"startTimeMs":"1200","words":"Hello"},
              {"startTimeMs":"3400","words":[{"string":"World"}]}
            ],"credits":{"sourceNames":["Ado"]}}}
        """.trimIndent()
        val lyrics = mapSpotifyLyrics(json.parseToJsonElement(raw).jsonObject)
        requireNotNull(lyrics)
        assertTrue(lyrics.synced)
        assertEquals(3, lyrics.lines.size)
        assertEquals(1200L, lyrics.lines[1].timeMs)
        assertEquals("Hello", lyrics.lines[1].text)
        assertEquals("World", lyrics.lines[2].text)
        assertEquals(listOf("Ado"), lyrics.writers)
    }

    @Test
    fun unsyncedLinesHaveNoTiming() {
        val raw = """{"lyrics":{"syncType":"UNSYNCED","lines":[{"words":"Line"}]}}"""
        val lyrics = mapSpotifyLyrics(json.parseToJsonElement(raw).jsonObject)
        requireNotNull(lyrics)
        assertFalse(lyrics.synced)
        assertEquals(-1L, lyrics.lines.single().timeMs)
    }

    @Test
    fun emptyPayloadIsNull() {
        assertNull(mapSpotifyLyrics(json.parseToJsonElement("""{"lyrics":{"lines":[]}}""").jsonObject))
    }
}
