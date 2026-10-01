package com.mss.android

import com.mss.android.data.SessionLog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class SessionLogTest {
    @Test
    fun masksBearerYandexTokenAndPassword() {
        val raw = "Bearer abc.def.ghi password=super-secret y0_ABCDEFGHIJK access_token=tok123"
        val masked = SessionLog.maskSecrets(raw)
        assertEquals(
            "Bearer *** password=*** y0_*** access_token=***",
            masked,
        )
        assertFalse(masked.contains("abc.def"))
        assertFalse(masked.contains("super-secret"))
        assertFalse(masked.contains("tok123"))
    }
}
