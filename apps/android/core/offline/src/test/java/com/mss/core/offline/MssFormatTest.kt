package com.mss.core.offline

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class MssFormatTest {
    @Test
    fun roundTrip() {
        val trackId = "11111111-2222-3333-4444-555555555555"
        val deviceId = "device-1"
        val secret = "offline-dev-secret"
        val payload = "opus-bytes".toByteArray()
        val key = MssFormat.deriveContentKey("user", deviceId, trackId, secret)
        val encoded = MssFormat.encode(trackId, deviceId, payload, key, secret)
        val (decodedId, decoded) = MssFormat.decode(encoded, deviceId, key, secret)
        assertEquals(trackId, decodedId)
        assertArrayEquals(payload, decoded)
    }
}
