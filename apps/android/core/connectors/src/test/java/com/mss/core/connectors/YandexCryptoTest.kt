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
    fun directLinkSignUsesSalt() {
        val hex = YandexCrypto.signDirectLink("file.mp3", "secret", "99")
        assertEquals(64, hex.length)
        assertEquals(
            YandexCrypto.hmacHex(YandexCrypto.DIRECT_LINK_SALT, YandexCrypto.DIRECT_LINK_SALT + "file.mp3secret99"),
            hex,
        )
    }
}
