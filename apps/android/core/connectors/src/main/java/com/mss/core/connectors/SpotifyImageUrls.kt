package com.mss.core.connectors

object SpotifyImageUrls {
    private val IMAGE_HASH = Regex("ab6761[0-9a-f]{18,}")

    fun normalize(raw: String?): String? {
        val url = raw?.trim().orEmpty()
        if (url.isEmpty()) return null
        val withScheme = when {
            url.startsWith("//") -> "https:$url"
            url.startsWith("http://") -> "https://${url.removePrefix("http://")}"
            url.startsWith("https://") -> url
            url.startsWith("spotify:image:") -> "https://i.scdn.co/image/${url.substringAfterLast(':')}"
            IMAGE_HASH.matches(url) -> "https://i.scdn.co/image/$url"
            else -> return null
        }
        val hash = IMAGE_HASH.find(withScheme)?.value
        if (hash != null && (withScheme.contains("encrypted") || withScheme.contains("image-cdn"))) {
            return "https://i.scdn.co/image/$hash"
        }
        return withScheme
    }
}
