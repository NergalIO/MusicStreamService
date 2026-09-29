package com.mss.android

import com.mss.core.model.parseLrc
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LyricsParseTest {
    @Test
    fun parseSyncedLrc() {
        val lines = parseLrc("[00:12.00]Hello\n[00:15.50]World")
        assertEquals(2, lines.size)
        assertEquals(12000, lines[0].timeMs)
        assertEquals("Hello", lines[0].text)
        assertTrue(lines[1].timeMs > lines[0].timeMs)
    }
}
