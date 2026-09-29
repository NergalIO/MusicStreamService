package com.mss.core.connectors

object SpotifyCookies {
    val URLS = listOf(
        "https://open.spotify.com/",
        "https://accounts.spotify.com/",
        "https://www.spotify.com/",
        "https://spotify.com/",
    )

    fun headerLooksLoggedIn(header: String?): Boolean {
        if (header.isNullOrBlank()) return false
        return header.split(';').any { part ->
            val name = part.substringBefore('=').trim().lowercase()
            name == "sp_dc" || name == "sp_key" || name.endsWith("-sp_dc") || name.endsWith("-sp_key")
        }
    }
}
