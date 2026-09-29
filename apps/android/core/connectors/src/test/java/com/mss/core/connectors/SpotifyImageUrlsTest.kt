package com.mss.core.connectors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SpotifyImageUrlsTest {
    @Test
    fun upgradesProtocolRelativeAndHttp() {
        assertEquals("https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcd", SpotifyImageUrls.normalize("//i.scdn.co/image/ab67616d0000b273abcdef0123456789abcd"))
        assertEquals("https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcd", SpotifyImageUrls.normalize("http://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcd"))
    }

    @Test
    fun mapsSpotifyImageUriAndEncryptedCdn() {
        assertEquals("https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcd", SpotifyImageUrls.normalize("spotify:image:ab67616d0000b273abcdef0123456789abcd"))
        assertEquals(
            "https://i.scdn.co/image/ab67616d0000b273abcdef0123456789abcd",
            SpotifyImageUrls.normalize("https://image-cdn-ak.spotifycdn.com/encrypted-image/ab67616d0000b273abcdef0123456789abcd"),
        )
    }

    @Test
    fun rejectsEmpty() {
        assertNull(SpotifyImageUrls.normalize(null))
        assertNull(SpotifyImageUrls.normalize(" "))
        assertNull(SpotifyImageUrls.normalize("not-an-image"))
    }
}
