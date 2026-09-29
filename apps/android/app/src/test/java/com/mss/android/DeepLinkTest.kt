package com.mss.android

import com.mss.android.ui.navigation.parseMssLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test

class DeepLinkTest {
    @Test
    fun parseTrack() {
        val action = parseMssLink("mss://track/yandex/123")
        assertNotNull(action)
        assertEquals("yandex", action!!.playSource)
        assertEquals("123", action.playId)
    }

    @Test
    fun parseLobby() {
        val action = parseMssLink("mss://lobby/ABC123")
        assertNotNull(action)
        assertEquals("ABC123", action!!.inviteCode)
    }

    @Test
    fun parseLibraryUploads() {
        val action = parseMssLink("mss://library/uploads")
        assertNotNull(action)
        assertEquals("library/uploads", action!!.route)
    }

    @Test
    fun parseAlbum() {
        val action = parseMssLink("mss://album/yandex/42")
        assertNotNull(action)
        assertEquals("album/yandex/42", action!!.route)
    }
}
