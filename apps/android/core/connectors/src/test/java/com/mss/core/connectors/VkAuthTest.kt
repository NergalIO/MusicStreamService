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
    fun authorizeUrlIsNotOauthResult() {
        val url = VkAuth.mobileAuthorizeUrl()
        org.junit.Assert.assertTrue(url.contains("blank.html"))
        org.junit.Assert.assertFalse(VkAuth.isOAuthBlankUrl(url))
        org.junit.Assert.assertFalse(VkAuth.shouldCompleteWebLogin(url))
        assertNull(VkAuth.parseOAuthRedirect(url))
    }

    @Test
    fun blankHtmlWithTokenCompletesLogin() {
        val url = "https://oauth.vk.com/blank.html#access_token=tok&user_id=42"
        org.junit.Assert.assertTrue(VkAuth.isOAuthBlankUrl(url))
        org.junit.Assert.assertTrue(VkAuth.shouldCompleteWebLogin(url))
    }

    @Test
    fun blankHtmlWithoutTokenDoesNotComplete() {
        org.junit.Assert.assertTrue(VkAuth.isOAuthBlankUrl("https://oauth.vk.com/blank.html"))
        org.junit.Assert.assertFalse(VkAuth.shouldCompleteWebLogin("https://oauth.vk.com/blank.html"))
    }

    @Test
    fun sessionCookieDetectsRemixSid() {
        org.junit.Assert.assertTrue(VkAuth.hasSessionCookie("remixsid=abc; remixlang=0"))
        org.junit.Assert.assertFalse(VkAuth.hasSessionCookie("remixlang=0"))
        org.junit.Assert.assertFalse(VkAuth.hasSessionCookie("remixstlid=anon; remixlang=0"))
    }

    @Test
    fun loginCookieNeedsLOrP() {
        org.junit.Assert.assertTrue(VkAuth.hasLoginCookie("remixlang=0; l=123"))
        org.junit.Assert.assertFalse(VkAuth.hasLoginCookie("remixlang=0; remixstlid=anon"))
    }

    @Test
    fun scrapesAccessTokenFromPageHtml() {
        val html = """{"access_token":"vk1.a.secret","uuid":"11111111-1111-1111-1111-111111111111"}"""
        val parsed = VkAuth.parsePageTokens(html)
        assertNotNull(parsed)
        assertEquals("vk1.a.secret", parsed!!.accessToken)
    }

    @Test
    fun otpAlreadySentDetectsSms() {
        org.junit.Assert.assertTrue(VkAuth.otpAlreadySent("sms"))
        org.junit.Assert.assertFalse(VkAuth.otpAlreadySent("password"))
    }
}
