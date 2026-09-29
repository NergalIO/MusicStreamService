package com.mss.core.connectors

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class YandexErrorsTest {
    @Test
    fun unauthorizedJsonBecomesSessionMessage() {
        val body = """{"result":{"name":"unauthorized","message":"EitherUserId is null"}}"""
        assertTrue(YandexErrors.isAuthFailure(401, body))
        assertEquals(YandexErrors.SESSION, YandexErrors.message(401, body))
    }

    @Test
    fun otherFailuresStayGeneric() {
        assertFalse(YandexErrors.isAuthFailure(500, "internal"))
        assertEquals("Не удалось выполнить запрос к Яндекс Музыке", YandexErrors.message(500, "internal"))
    }
}
