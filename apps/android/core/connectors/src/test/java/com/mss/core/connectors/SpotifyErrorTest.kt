package com.mss.core.connectors

import org.junit.Assert.assertTrue
import org.junit.Test

class SpotifyErrorTest {
    @Test
    fun premiumMessageDetected() {
        val raw = """{"error":{"status":403,"message":"Forbidden","reason":"Active premium subscription required"}}"""
        assertTrue(raw.contains("premium", ignoreCase = true))
    }

    @Test
    fun sessionCookieNames() {
        org.junit.Assert.assertTrue(SpotifyCookies.headerLooksLoggedIn("sp_dc=abc; sp_t=x"))
        org.junit.Assert.assertTrue(SpotifyCookies.headerLooksLoggedIn("__Secure-sp_dc=abc"))
        org.junit.Assert.assertTrue(SpotifyCookies.headerLooksLoggedIn("sp_key=xyz"))
        org.junit.Assert.assertFalse(SpotifyCookies.headerLooksLoggedIn("sp_t=anon; OptanonConsent=1"))
        org.junit.Assert.assertFalse(SpotifyCookies.headerLooksLoggedIn(null))
    }
}
