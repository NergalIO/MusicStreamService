package com.mss.core.connectors

import android.webkit.CookieManager

/**
 * Cookie WebView переживают отключение сервиса, поэтому следующий вход может молча подхватить
 * прошлый аккаунт. Гасим их по всем вариантам домена и пути, а не только по видимым именам.
 */
object WebCookies {
    private const val EXPIRED = "Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"

    val SPOTIFY_URLS = SpotifyCookies.URLS
    val SPOTIFY_DOMAINS = listOf(".spotify.com")

    val VK_URLS = listOf(
        "https://vk.com/",
        "https://vk.ru/",
        "https://m.vk.com/",
        "https://m.vk.ru/",
        "https://login.vk.com/",
        "https://login.vk.ru/",
        "https://id.vk.com/",
        "https://id.vk.ru/",
        "https://oauth.vk.com/",
        "https://api.vk.com/",
    )
    val VK_DOMAINS = listOf(".vk.com", ".vk.ru")

    /** @param extraNames имена, которые нужно погасить, даже если их не видно в заголовке. */
    fun clear(urls: List<String>, domains: List<String>, extraNames: Collection<String> = emptyList()) {
        val cm = runCatching { CookieManager.getInstance() }.getOrNull() ?: return
        val names = linkedSetOf<String>()
        names += extraNames
        for (url in urls) {
            cm.getCookie(url)?.split(';')?.forEach { part ->
                val name = part.substringBefore('=').trim()
                if (name.isNotBlank()) names += name
            }
        }
        if (names.isEmpty()) return
        for (url in urls) {
            for (name in names) {
                for (suffix in SUFFIXES) {
                    cm.setCookie(url, "$name=; $EXPIRED; $suffix")
                    for (domain in domains) cm.setCookie(url, "$name=; $EXPIRED; $suffix; Domain=$domain")
                }
            }
        }
        runCatching { cm.flush() }
    }

    private val SUFFIXES = listOf("Path=/", "Path=/; Secure")
}
