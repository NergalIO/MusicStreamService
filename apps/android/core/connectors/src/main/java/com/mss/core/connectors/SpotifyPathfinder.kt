package com.mss.core.connectors

import com.mss.core.model.AlbumWithTracks
import com.mss.core.model.TrackLyrics
import com.mss.core.model.FeedBlock
import com.mss.core.model.FeedItem
import com.mss.core.model.PlaylistWithTracks
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedAlbum
import com.mss.core.model.UnifiedArtist
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.coroutines.delay
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

@Singleton
class SpotifyPathfinder @Inject constructor(
    private val web: SpotifyWebSession,
) {
    private val json = Json { ignoreUnknownKeys = true }

    suspend fun searchTracks(query: String, limit: Int): List<UnifiedTrack> {
        val data = query(
            "searchTracks",
            buildJsonObject {
                put("searchTerm", query)
                put("offset", 0)
                put("limit", minOf(limit, 50))
                put("numberOfTopResults", 20)
                put("includeAudiobooks", false)
                put("includePreReleases", false)
                put("includeAlbumPreReleases", false)
                put("includeAuthors", false)
                put("includeEpisodeContentRatingsV2", false)
            },
        )
        val items = data.obj("data")?.obj("searchV2")?.obj("tracksV2")?.arr("items") ?: return emptyList()
        return items.mapNotNull { mapTrack(it.jsonObject.obj("item")?.obj("data")) }
    }

    suspend fun savedTracks(limit: Int): List<UnifiedTrack> {
        val out = mutableListOf<UnifiedTrack>()
        var offset = 0
        while (out.size < limit) {
            val data = query(
                "fetchLibraryTracks",
                buildJsonObject {
                    put("offset", offset)
                    put("limit", 50)
                },
            )
            val page = data.obj("data")?.obj("me")?.obj("library")?.obj("tracks")
            val items = page?.arr("items") ?: break
            items.forEach { row ->
                val trackObj = row.jsonObject.obj("track")
            val uri = trackObj?.str("_uri")
            val data = trackObj?.obj("data")
            val merged = if (data != null && uri != null) JsonObject(data + ("uri" to JsonPrimitive(uri))) else data
            mapTrack(merged)?.let { out += it }
            }
            if (items.size < 50) break
            offset += 50
        }
        return out.take(limit)
    }

    suspend fun listPlaylists(): List<UnifiedPlaylist> {
        val data = query(
            "libraryV3",
            buildJsonObject {
                put("filters", buildJsonArray { add(JsonPrimitive("Playlists")) })
                put("order", JsonNull)
                put("textFilter", "")
                put("features", buildJsonArray {
                    add(JsonPrimitive("LIKED_SONGS"))
                    add(JsonPrimitive("YOUR_EPISODES"))
                })
                put("limit", 50)
                put("offset", 0)
                put("flatten", true)
                put("expandedFolders", buildJsonArray {})
                put("folderUri", JsonNull)
                put("includeFoldersWhenFlattening", false)
            },
        )
        val items = data.obj("data")?.obj("me")?.obj("libraryV3")?.arr("items") ?: return emptyList()
        return items.mapNotNull { row ->
            val d = row.jsonObject.obj("item")?.obj("data") ?: return@mapNotNull null
            mapPlaylist(d)
        }
    }

    suspend fun playlist(id: String): PlaylistWithTracks {
        val tracks = mutableListOf<UnifiedTrack>()
        var title = "Плейлист"
        var cover: String? = null
        var owner: String? = null
        for (offset in 0 until 2000 step 100) {
            val data = query(
                "fetchPlaylist",
                buildJsonObject {
                    put("uri", "spotify:playlist:$id")
                    put("offset", offset)
                    put("limit", 100)
                    put("enableWatchFeedEntrypoint", false)
                    put("includeEpisodeContentRatingsV2", false)
                },
            )
            val p = data.obj("data")?.obj("playlistV2") ?: break
            title = p.str("name") ?: title
            owner = p.obj("ownerV2")?.obj("data")?.str("name") ?: owner
            cover = bestImage(p.obj("images")?.arr("items")?.firstOrNull()?.jsonObject?.arr("sources")) ?: cover
            val items = p.obj("content")?.arr("items") ?: JsonArray(emptyList())
            items.forEach { row ->
                mapTrack(row.jsonObject.obj("itemV2")?.obj("data"))?.let { tracks += it }
            }
            if (items.size < 100) break
        }
        return PlaylistWithTracks(SourceId.SPOTIFY, id, title, owner = owner, coverUrl = cover, trackCount = tracks.size, tracks = tracks)
    }

    suspend fun album(id: String): AlbumWithTracks {
        val data = query(
            "getAlbum",
            buildJsonObject {
                put("uri", "spotify:album:$id")
                put("locale", "")
                put("offset", 0)
                put("limit", 50)
            },
        )
        val a = data.obj("data")?.obj("albumUnion") ?: throw ConnectorException("Альбом Spotify не найден")
        val title = a.str("name") ?: "Альбом"
        val cover = bestImage(a.obj("coverArt")?.arr("sources"))
        val artist = a.obj("artists")?.arr("items")?.mapNotNull {
            it.jsonObject.obj("profile")?.str("name")
        }?.joinToString().orEmpty()
        val tracks = a.obj("tracksV2")?.arr("items")?.mapNotNull { row ->
            mapTrack(row.jsonObject.obj("track"))
        }.orEmpty()
        return AlbumWithTracks(SourceId.SPOTIFY, id, title, artist, coverUrl = cover, trackCount = tracks.size, tracks = tracks)
    }

    suspend fun homeFeed(): List<FeedBlock> {
        val data = query(
            "home",
            buildJsonObject {
                put("homeEndUserIntegration", "INTEGRATION_WEB_PLAYER")
                put("timeZone", java.util.TimeZone.getDefault().id)
                put("sp_t", "")
                put("facet", "")
                put("sectionItemsLimit", 12)
            },
        )
        val sections = data.obj("data")?.obj("home")?.obj("sectionContainer")?.obj("sections")?.arr("items")
            ?: return emptyList()
        return sections.mapIndexedNotNull { i, s ->
            val obj = s.jsonObject
            val title = obj.obj("data")?.obj("title")?.str("transformedLabel")
                ?: obj.obj("data")?.obj("title")?.str("text")
                ?: return@mapIndexedNotNull null
            val items = obj.obj("sectionItems")?.arr("items")?.mapNotNull { mapHomeItem(it.jsonObject.obj("content")) }.orEmpty()
            if (items.isEmpty()) null else FeedBlock(obj.str("uri") ?: "section-$i", title, items)
        }
    }

    suspend fun trackRadio(trackId: String): PlaylistWithTracks {
        val path = "/inspiredby-mix/v2/seed_to_playlist/spotify:track:${java.net.URLEncoder.encode(trackId, Charsets.UTF_8)}?response-format=json"
        val (status, text) = exchange("GET", "https://spclient.wg.spotify.com$path", null)
        if (status !in 200..299) {
            throw ConnectorException(if (status == 429) "Spotify просит подождать — повторите через минуту" else "У этого трека нет радио в Spotify")
        }
        val seed = json.parseToJsonElement(text).jsonObject
        val uri = seed.arr("mediaItems")?.firstOrNull()?.jsonObject?.str("uri")
        if (uri.isNullOrBlank() || !uri.startsWith("spotify:playlist:")) {
            throw ConnectorException("У этого трека нет радио в Spotify")
        }
        return playlist(idFromUri(uri) ?: throw ConnectorException("У этого трека нет радио в Spotify"))
    }

    suspend fun lyrics(trackId: String): TrackLyrics? {
        val id = trackId.substringAfterLast(':').trim()
        if (id.isEmpty()) return null
        val encoded = java.net.URLEncoder.encode(id, Charsets.UTF_8).replace("+", "%20")
        val (status, text) = exchange(
            "GET",
            "https://spclient.wg.spotify.com/color-lyrics/v2/track/$encoded?format=json&vocalRemoval=false&market=from_token",
            null,
        )
        if (status == 404 || status == 403) return null
        if (status !in 200..299) {
            throw ConnectorException(
                if (status == 429) "Spotify просит подождать — повторите через минуту" else "Spotify $status",
            )
        }
        return mapSpotifyLyrics(json.parseToJsonElement(text).jsonObject)
    }

    private suspend fun query(name: String, variables: JsonObject): JsonObject {
        val hash = hashFor(name)
        val (status, text) = post(name, variables, hash)
        if (status == 400 && text.contains("PersistedQueryNotFound", true)) {
            web.invalidateHashes()
            val (againStatus, againText) = post(name, variables, hashFor(name))
            if (againStatus !in 200..299) throw ConnectorException("Spotify pathfinder $againStatus")
            return json.parseToJsonElement(againText).jsonObject
        }
        if (status !in 200..299) throw ConnectorException("Spotify pathfinder $status")
        return json.parseToJsonElement(text).jsonObject
    }

    private suspend fun post(name: String, variables: JsonObject, hash: String): Pair<Int, String> {
        val body = buildJsonObject {
            put("variables", variables)
            put("operationName", name)
            putJsonObject("extensions") {
                putJsonObject("persistedQuery") {
                    put("version", 1)
                    put("sha256Hash", hash)
                }
            }
        }
        return exchange("POST", "https://api-partner.spotify.com/pathfinder/v2/query", body.toString())
    }

    private suspend fun exchange(method: String, url: String, body: String?): Pair<Int, String> {
        val first = web.browserFetch(method, url, body)
        if (first.first != 401 && first.first != 403) return first
        web.invalidateHeaders()
        return web.browserFetch(method, url, body)
    }

    private suspend fun hashFor(name: String): String {
        web.operationHash(name)?.let { return it }
        web.invalidateHashes()
        repeat(40) {
            delay(250)
            web.operationHash(name)?.let { return it }
        }
        throw ConnectorException("Веб-плеер Spotify не знает запрос $name")
    }

    private fun mapTrack(d: JsonObject?): UnifiedTrack? {
        if (d == null) return null
        val uri = d.str("uri") ?: d.str("_uri") ?: return null
        if (!uri.startsWith("spotify:track:")) return null
        val name = d.str("name") ?: return null
        val artists = d.obj("artists")?.arr("items")?.mapNotNull {
            val n = it.jsonObject.obj("profile")?.str("name") ?: return@mapNotNull null
            com.mss.core.model.ArtistRef(idFromUri(it.jsonObject.str("uri")).orEmpty(), n)
        }.orEmpty()
        val playable = d.obj("playability")?.get("playable")?.jsonPrimitive?.contentOrNull != "false"
        return UnifiedTrack(
            source = SourceId.SPOTIFY,
            id = idFromUri(uri) ?: return null,
            title = name,
            artist = artists.joinToString { it.name }.ifBlank { "Unknown" },
            artists = artists.takeIf { it.isNotEmpty() },
            album = d.obj("albumOfTrack")?.str("name"),
            albumId = idFromUri(d.obj("albumOfTrack")?.str("uri")),
            durationMs = d.obj("duration")?.get("totalMilliseconds")?.jsonPrimitive?.contentOrNull?.toLongOrNull()
                ?: d.obj("trackDuration")?.get("totalMilliseconds")?.jsonPrimitive?.contentOrNull?.toLongOrNull(),
            coverUrl = coverOf(d),
            playable = playable,
        )
    }

    private fun mapPlaylist(d: JsonObject): UnifiedPlaylist? {
        val uri = d.str("uri") ?: return null
        if (!uri.startsWith("spotify:playlist:")) return null
        return UnifiedPlaylist(
            source = SourceId.SPOTIFY,
            id = idFromUri(uri) ?: return null,
            title = d.str("name") ?: return null,
            owner = d.obj("ownerV2")?.obj("data")?.str("name"),
            coverUrl = coverOf(d),
            trackCount = d.obj("content")?.get("totalCount")?.jsonPrimitive?.contentOrNull?.toIntOrNull(),
        )
    }

    private fun mapHomeItem(content: JsonObject?): FeedItem? {
        val d = content?.obj("data") ?: return null
        return when (content.str("__typename")) {
            "AlbumResponseWrapper" -> mapAlbum(d)?.let { FeedItem("album", album = it) }
            "PlaylistResponseWrapper" -> mapPlaylist(d)?.let { FeedItem("playlist", playlist = it) }
            "ArtistResponseWrapper" -> {
                val id = idFromUri(d.str("uri")) ?: return null
                val name = d.obj("profile")?.str("name") ?: return null
                FeedItem("artist", artist = UnifiedArtist(SourceId.SPOTIFY, id, name, imageUrl = coverOf(d)))
            }
            else -> null
        }
    }

    private fun mapAlbum(d: JsonObject): UnifiedAlbum? {
        val id = idFromUri(d.str("uri")) ?: return null
        if (d.str("uri")?.startsWith("spotify:album:") != true) return null
        return UnifiedAlbum(
            source = SourceId.SPOTIFY,
            id = id,
            title = d.str("name") ?: return null,
            artist = d.obj("artists")?.arr("items")?.mapNotNull { it.jsonObject.obj("profile")?.str("name") }?.joinToString().orEmpty(),
            coverUrl = coverOf(d),
        )
    }

    private fun coverOf(d: JsonObject): String? {
        bestImage(d.obj("coverArt")?.arr("sources"))?.let { return it }
        bestImage(d.obj("albumOfTrack")?.obj("coverArt")?.arr("sources"))?.let { return it }
        bestImage(d.obj("images")?.arr("items")?.firstOrNull()?.jsonObject?.arr("sources"))?.let { return it }
        bestImage(d.obj("visuals")?.obj("avatarImage")?.arr("sources"))?.let { return it }
        return imageUrl(d.obj("coverArt")?.str("url") ?: d.str("imageUrl"))
    }

    private fun bestImage(sources: JsonArray?): String? {
        if (sources == null || sources.isEmpty()) return null
        val ranked = sources.mapNotNull { el ->
            val obj = el as? JsonObject ?: return@mapNotNull null
            imageUrl(obj.str("url"))?.let { it to (obj["width"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0) }
        }
        return ranked.maxByOrNull { it.second }?.first
    }

    private fun imageUrl(raw: String?): String? {
        val url = raw?.trim().orEmpty()
        if (url.isEmpty()) return null
        return when {
            url.startsWith("//") -> "https:$url"
            url.startsWith("http://") || url.startsWith("https://") -> url
            else -> null
        }
    }

    private fun idFromUri(uri: String?): String? = uri?.substringAfterLast(':')?.takeIf { it.isNotBlank() }

    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
    private fun JsonObject.arr(key: String): JsonArray? = this[key] as? JsonArray
    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
}
