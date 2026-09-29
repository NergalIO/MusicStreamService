package com.mss.core.connectors

import com.mss.core.model.AlbumWithTracks
import com.mss.core.model.FeedBlock
import com.mss.core.model.FeedItem
import com.mss.core.model.PlaylistWithTracks
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedAlbum
import com.mss.core.model.UnifiedArtist
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.http.isSuccess
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
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

@Singleton
class SpotifyPathfinder @Inject constructor(
    private val web: SpotifyWebSession,
) {
    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient(OkHttp)

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

    private suspend fun query(name: String, variables: JsonObject): JsonObject {
        val headers = web.headers ?: throw ConnectorException("Нет заголовков веб-плеера Spotify")
        val hash = web.operationHash(name) ?: throw ConnectorException("Веб-плеер Spotify не знает запрос $name")
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
        val res = http.post("https://api-partner.spotify.com/pathfinder/v2/query") {
            header("authorization", headers.authorization)
            header("client-token", headers.clientToken)
            header("spotify-app-version", headers.appVersion)
            header("app-platform", "WebPlayer")
            contentType(ContentType.Application.Json)
            setBody(body.toString())
        }
        val text = res.bodyAsText()
        if (!res.status.isSuccess()) {
            if (text.contains("PersistedQueryNotFound", true)) web.invalidateHashes()
            throw ConnectorException("Spotify pathfinder ${res.status.value}")
        }
        return json.parseToJsonElement(text).jsonObject
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
            coverUrl = bestImage(d.obj("albumOfTrack")?.obj("coverArt")?.arr("sources")),
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
            coverUrl = bestImage(d.obj("images")?.arr("items")?.firstOrNull()?.jsonObject?.arr("sources")),
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
                FeedItem("artist", artist = UnifiedArtist(SourceId.SPOTIFY, id, name, imageUrl = bestImage(d.obj("visuals")?.obj("avatarImage")?.arr("sources"))))
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
            coverUrl = bestImage(d.obj("coverArt")?.arr("sources")),
        )
    }

    private fun bestImage(sources: JsonArray?): String? {
        if (sources == null || sources.isEmpty()) return null
        return sources.maxByOrNull {
            it.jsonObject["width"]?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0
        }?.jsonObject?.str("url") ?: sources.first().jsonObject.str("url")
    }

    private fun idFromUri(uri: String?): String? = uri?.substringAfterLast(':')?.takeIf { it.isNotBlank() }

    private fun JsonObject.obj(key: String): JsonObject? = this[key] as? JsonObject
    private fun JsonObject.arr(key: String): JsonArray? = this[key] as? JsonArray
    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
}
