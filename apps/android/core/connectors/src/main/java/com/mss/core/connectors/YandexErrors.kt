package com.mss.core.connectors

object YandexErrors {
    const val SESSION = "Сессия Яндекса не принята — войдите снова"

    /**
     * 403 Яндекс отдаёт и без подписки, и на отдельные треки, поэтому сам по себе он не значит,
     * что сессия протухла: иначе обычный отказ по правам выкидывал бы из аккаунта.
     */
    fun isAuthFailure(status: Int, body: String): Boolean {
        val lower = body.lowercase()
        if ("unauthorized" in lower || "eitheruserid" in lower || "invalid token" in lower) return true
        return status == 401
    }

    fun message(status: Int, body: String): String {
        if (isAuthFailure(status, body)) return SESSION
        if (status == 403) return "Яндекс не дал доступ к этому — проверьте подписку Плюс"
        return "Не удалось выполнить запрос к Яндекс Музыке"
    }
}
