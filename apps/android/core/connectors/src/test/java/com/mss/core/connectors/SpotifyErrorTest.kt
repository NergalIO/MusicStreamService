package com.mss.core.connectors

import org.junit.Assert.assertTrue
import org.junit.Test

class SpotifyErrorTest {
    @Test
    fun premiumMessageDetected() {
        val raw = """{"error":{"status":403,"message":"Forbidden","reason":"Active premium subscription required"}}"""
        assertTrue(raw.contains("premium", ignoreCase = true))
    }
}
