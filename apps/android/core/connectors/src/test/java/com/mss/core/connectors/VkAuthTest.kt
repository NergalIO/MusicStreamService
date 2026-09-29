package com.mss.core.connectors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class VkAuthTest {
    @Test
    fun normalizesRussianPhone() {
        assertEquals("+79001234567", VkAuth.normalizePhone("8 (900) 123-45-67"))
        assertEquals("+79001234567", VkAuth.normalizePhone("79001234567"))
        assertEquals("+79001234567", VkAuth.normalizePhone("9001234567"))
    }

    @Test
    fun blankHtmlWithoutTokenIsNotSuccess() {
        assertNull(VkAuth.parseOAuthRedirect("https://oauth.vk.com/blank.html"))
    }

    @Test
    fun readsTokenFromHash() {
        val parsed = VkAuth.parseOAuthRedirect("https://oauth.vk.com/blank.html#access_token=tok&user_id=42")
        assertNotNull(parsed)
        assertEquals("tok", parsed!!.accessToken)
        assertEquals(42L, parsed.userId)
    }

    @Test
    fun mobileAuthorizeUsesPhoneLayout() {
        val url = VkAuth.mobileAuthorizeUrl()
        org.junit.Assert.assertTrue(url.contains("display=mobile"))
        org.junit.Assert.assertTrue(url.contains("client_id=${VkAuth.ANDROID_CLIENT_ID}"))
        org.junit.Assert.assertTrue(url.contains("blank.html"))
    }

    @Test
    fun otpAlreadySentDetectsSms() {
        org.junit.Assert.assertTrue(VkAuth.otpAlreadySent("sms"))
        org.junit.Assert.assertFalse(VkAuth.otpAlreadySent("password"))
    }
}
