package com.mss.core.connectors

import com.mss.core.model.ArtistRef
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedAlbum
import com.mss.core.model.UnifiedArtist
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

fun yandexImage(uri: String?, size: String = "400x400"): String? {
    if (uri.isNullOrBlank()) return null
    val withSize = uri.replace("%%", size)
    return if (withSize.startsWith("http")) withSize else "https://$withSize"
}

fun trackBaseId(trackId: String): String = trackId.substringBefore(':')

fun trackKey(track: UnifiedTrack): String =
    if (!track.albumId.isNullOrBlank()) "${trackBaseId(track.id)}:${track.albumId}" else trackBaseId(track.id)

private fun JsonObject.str(key: String): String? = (this[key] as? kotlinx.serialization.json.JsonPrimitive)?.contentOrNull

private fun artistRefs(arr: JsonArray?): List<ArtistRef> {
    if (arr == null) return emptyList()
    return arr.mapNotNull { el ->
        val o = el.jsonObject
        val name = o.str("name") ?: return@mapNotNull null
        ArtistRef(id = o.str("id").orEmpty(), name = name)
    }
}

private fun withVersion(title: String, version: String?): String =
    if (version.isNullOrBlank()) title else "$title ($version)"

fun mapYandexTrack(obj: JsonObject): UnifiedTrack? {
    val id = obj.str("id") ?: return null
    val title = obj.str("title") ?: return null
    val artists = artistRefs(obj["artists"]?.jsonArray)
    val album = obj["albums"]?.jsonArray?.firstOrNull()?.jsonObject
    val available = obj["available"]?.jsonPrimitive?.contentOrNull != "false"
    val r128 = obj["r128"]?.jsonObject
    return UnifiedTrack(
        source = SourceId.YANDEX,
        id = id,
        title = withVersion(title, obj.str("version")),
        artist = artists.joinToString { it.name }.ifBlank { "Неизвестный" },
        artists = artists.takeIf { it.isNotEmpty() },
        album = album?.str("title"),
        albumId = album?.str("id"),
        durationMs = obj["durationMs"]?.jsonPrimitive?.longOrNull,
        coverUrl = yandexImage(album?.str("coverUri") ?: obj.str("coverUri") ?: obj.str("ogImage")),
        explicit = obj.str("contentWarning") == "explicit",
        playable = available,
        unplayableReason = if (available) null else "Трек недоступен в Яндекс Музыке",
        loudnessLufs = r128?.get("i")?.jsonPrimitive?.doubleOrNull,
    )
}

fun mapYandexAlbum(obj: JsonObject): UnifiedAlbum? {
    val id = obj.str("id") ?: return null
    val title = obj.str("title") ?: return null
    val artists = artistRefs(obj["artists"]?.jsonArray)
    val trackCount = obj["trackCount"]?.jsonPrimitive?.intOrNull
    return UnifiedAlbum(
        source = SourceId.YANDEX,
        id = id,
        title = withVersion(title, obj.str("version")),
        artist = artists.joinToString { it.name },
        artists = artists.takeIf { it.isNotEmpty() },
        year = obj["year"]?.jsonPrimitive?.intOrNull,
        coverUrl = yandexImage(obj.str("coverUri") ?: obj.str("ogImage"), "600x600"),
        trackCount = trackCount,
        type = obj.str("type") ?: if (trackCount != null && trackCount <= 3) "single" else "album",
        genre = obj.str("genre"),
    )
}

fun mapYandexArtist(obj: JsonObject): UnifiedArtist? {
    val id = obj.str("id") ?: return null
    val name = obj.str("name") ?: return null
    val cover = obj["cover"]?.jsonObject?.str("uri")
    return UnifiedArtist(
        source = SourceId.YANDEX,
        id = id,
        name = name,
        imageUrl = yandexImage(cover ?: obj.str("ogImage"), "600x600"),
        genres = obj["genres"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull },
        trackCount = obj["counts"]?.jsonObject?.get("tracks")?.jsonPrimitive?.intOrNull,
        followers = obj["likesCount"]?.jsonPrimitive?.intOrNull,
        description = obj.str("description") ?: obj.str("ogDescription"),
    )
}

/** Без владельца плейлист не открыть: id вида «null:kind» привёл бы к запросу /users/null/... */
fun mapYandexPlaylistOrNull(obj: JsonObject): UnifiedPlaylist? {
    val uid = obj["owner"]?.jsonObject?.str("uid") ?: obj.str("uid")
    return if (uid.isNullOrBlank()) null else mapYandexPlaylist(obj)
}

fun mapYandexPlaylist(obj: JsonObject): UnifiedPlaylist {
    val owner = obj["owner"]?.jsonObject
    val ownerUid = owner?.str("uid") ?: obj.str("uid") ?: ""
    val kind = obj.str("kind") ?: "0"
    val coverUri = obj["cover"]?.jsonObject?.str("uri")
        ?: obj["cover"]?.jsonObject?.get("itemsUri")?.jsonArray?.firstOrNull()?.jsonPrimitive?.contentOrNull
        ?: obj.str("ogImage")
    return UnifiedPlaylist(
        source = SourceId.YANDEX,
        id = "$ownerUid:$kind",
        title = obj.str("title") ?: "Плейлист",
        owner = owner?.str("name") ?: owner?.str("login"),
        description = obj.str("description"),
        coverUrl = yandexImage(coverUri, "600x600"),
        trackCount = obj["trackCount"]?.jsonPrimitive?.intOrNull,
    )
}
