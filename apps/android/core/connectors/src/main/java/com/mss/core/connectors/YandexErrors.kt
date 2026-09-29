package com.mss.core.connectors

object YandexErrors {
    const val SESSION = "Сессия Яндекса не принята — войдите снова"

    fun isAuthFailure(status: Int, body: String): Boolean {
        if (status == 401 || status == 403) return true
        val lower = body.lowercase()
        return "unauthorized" in lower || "eitheruserid" in lower || "invalid token" in lower
    }

    fun message(status: Int, body: String): String {
        if (isAuthFailure(status, body)) return SESSION
        return "Не удалось выполнить запрос к Яндекс Музыке"
    }
}
