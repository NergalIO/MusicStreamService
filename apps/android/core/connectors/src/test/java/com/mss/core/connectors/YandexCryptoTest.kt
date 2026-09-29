package com.mss.core.connectors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class YandexCryptoTest {
    @Test
    fun signTrackIsHmacSha256Base64() {
        val sign = YandexCrypto.signTrack("123:456", 1_700_000_000L)
        val expected = YandexCrypto.hmacBase64(YandexCrypto.ANDROID_SIGN_KEY, "1231700000000")
        assertEquals(expected, sign)
        assertTrue(sign.isNotBlank())
    }

    @Test
    fun directUrlUsesMd5LikeDesktop() {
        val url = YandexCrypto.directUrl("storage.example", "mp3", "/foo/bar.mp3", "secret", "99")
        val hash = YandexCrypto.md5Hex(YandexCrypto.DIRECT_LINK_SALT + "foo/bar.mp3" + "secret")
        assertEquals("https://storage.example/get-mp3/$hash/99/foo/bar.mp3", url)
        assertEquals(32, hash.length)
    }
}
