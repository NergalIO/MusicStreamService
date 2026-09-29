package com.mss.core.connectors

import com.mss.core.datastore.TokenVault
import com.mss.core.model.AlbumWithTracks
import com.mss.core.model.ArtistProfile
import com.mss.core.model.DeviceCodePrompt
import com.mss.core.model.FeedBlock
import com.mss.core.model.FeedItem
import com.mss.core.model.PlaybackReport
import com.mss.core.model.PlaylistWithTracks
import com.mss.core.model.SourceId
import com.mss.core.model.TrackLyrics
import com.mss.core.model.UnifiedAlbum
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import com.mss.core.model.WaveBatch
import com.mss.core.model.WaveSettings
import com.mss.core.model.parseLrc
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.Parameters
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import java.util.concurrent.atomic.AtomicReference
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Singleton
class YandexConnector @Inject constructor(
    private val vault: TokenVault,
) : StreamConnector {
    override val id = SourceId.YANDEX
    override val displayName = "Яндекс Музыка"

    private val clientId = BuildConfig.YANDEX_CLIENT_ID.ifBlank { MUSIC_CLIENT_ID }
    private val clientSecret = BuildConfig.YANDEX_CLIENT_SECRET.ifBlank { MUSIC_CLIENT_SECRET }
    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient(OkHttp)
    private val queueMutex = Mutex()
    private val loginAbort = AtomicReference(false)
    private var pendingPrompt: DeviceCodePrompt? = null
    private var radioSession: WaveBatch? = null

    override fun authStatus(): AuthStatus {
        val t = loadTokens() ?: return AuthStatus.DISCONNECTED
        if (t.clientId != clientId) return AuthStatus.EXPIRED
        if (System.currentTimeMillis() >= t.expiresAt && t.refreshToken.isNullOrBlank()) return AuthStatus.EXPIRED
        return AuthStatus.CONNECTED
    }

    fun currentDevicePrompt(): DeviceCodePrompt? = pendingPrompt

    suspend fun login(onPrompt: (DeviceCodePrompt) -> Unit) {
        loginAbort.set(false)
        val deviceCode = oauthForm<DeviceCodeResponse>(
            "https://oauth.yandex.ru/device/code",
            mapOf(
                "client_id" to clientId,
                "device_id" to randomHex(8),
                "device_name" to "MusicStreamService Android",
            ),
        )
        val prompt = DeviceCodePrompt(
            source = SourceId.YANDEX,
            userCode = deviceCode.userCode,
            verificationUrl = deviceCode.verificationUrl,
            expiresIn = deviceCode.expiresIn,
            interval = deviceCode.interval,
        )
        pendingPrompt = prompt
        onPrompt(prompt)
        val deadline = System.currentTimeMillis() + deviceCode.expiresIn * 1000L
        val intervalMs = maxOf(deviceCode.interval, 1) * 1000L
        while (System.currentTimeMillis() < deadline) {
            delay(intervalMs)
            if (loginAbort.get()) throw CancellationException("Вход отменён")
            try {
                val token = oauthForm<YandexTokenResponse>(
                    "https://oauth.yandex.ru/token",
                    mapOf(
                        "grant_type" to "device_code",
                        "code" to deviceCode.deviceCode,
                        "client_id" to clientId,
                        "client_secret" to clientSecret,
                    ),
                )
                saveTokens(
                    YandexTokens(
                        accessToken = token.accessToken,
                        refreshToken = token.refreshToken,
                        expiresAt = System.currentTimeMillis() + token.expiresIn * 1000,
                        clientId = clientId,
                    ),
                )
                pendingPrompt = null
                try {
                    userId()
                } catch (_: Exception) {
                    disconnect()
                    throw ConnectorException(YandexErrors.SESSION)
                }
                return
            } catch (e: ConnectorException) {
                if (e.message?.contains("authorization_pending") == true) continue
                throw e
            }
        }
        throw ConnectorException("Код подтверждения истёк")
    }

    fun cancelLogin() {
        loginAbort.set(true)
    }

    override suspend fun disconnect() {
        vault.delete(VAULT_KEY)
        vault.delete(ACCOUNT_KEY)
    }

    override suspend fun search(query: String, limit: Int): List<UnifiedTrack> {
        val data = apiGet<JsonObject>(
            "/search?text=${encode(query)}&type=track&page=0&pageSize=$limit",
        )
        val results = data["tracks"]?.jsonObject?.get("results")?.jsonArray ?: return emptyList()
        return results.mapNotNull { mapYandexTrack(it.jsonObject) }
    }

    suspend fun searchAlbums(query: String, limit: Int = 20): List<UnifiedAlbum> {
        val data = apiGet<JsonObject>(
            "/search?text=${encode(query)}&type=album&page=0&pageSize=$limit",
        )
        val results = data["albums"]?.jsonObject?.get("results")?.jsonArray ?: return emptyList()
        return results.mapNotNull { mapYandexAlbum(it.jsonObject) }.take(limit)
    }

    suspend fun searchPlaylists(query: String, limit: Int = 20): List<UnifiedPlaylist> {
        val data = apiGet<JsonObject>(
            "/search?text=${encode(query)}&type=playlist&page=0&pageSize=$limit",
        )
        val results = data["playlists"]?.jsonObject?.get("results")?.jsonArray ?: return emptyList()
        return results.map { mapYandexPlaylist(it.jsonObject) }.take(limit)
    }

    suspend fun suggest(part: String): List<String> {
        val data = apiGet<JsonObject>("/search/suggest?part=${encode(part)}")
        return data["suggestions"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }?.take(8) ?: emptyList()
    }

    override suspend fun listPlaylists(): List<UnifiedPlaylist> {
        val uid = userId()
        val own = apiGet<JsonArray>("/users/$uid/playlists/list")
        val liked = runCatching { apiGet<JsonArray>("/users/$uid/likes/playlists") }.getOrNull()
        val all = own.map { mapYandexPlaylist(it.jsonObject) } +
            (liked?.mapNotNull { it.jsonObject["playlist"]?.jsonObject?.let(::mapYandexPlaylist) } ?: emptyList())
        val seen = mutableSetOf<String>()
        return all.filter { seen.add(it.id) }
    }

    suspend fun playlist(id: String): PlaylistWithTracks {
        val (ownerUid, kind) = id.split(":").let { it[0] to (it.getOrNull(1) ?: id) }
        val data = apiGet<JsonObject>("/users/$ownerUid/playlists/$kind")
        val entries = data["tracks"]?.jsonArray ?: JsonArray(emptyList())
        val rich = entries.mapNotNull { it.jsonObject["track"]?.jsonObject?.let(::mapYandexTrack) }
        val missing = entries.mapNotNull {
            val o = it.jsonObject
            if (o["track"] == null) o["id"]?.jsonPrimitive?.contentOrNull else null
        }
        val tracks = if (missing.isEmpty()) rich else rich + tracksByIds(missing)
        val meta = mapYandexPlaylist(data)
        return PlaylistWithTracks(
            source = meta.source,
            id = meta.id,
            title = meta.title,
            owner = meta.owner,
            description = meta.description,
            coverUrl = meta.coverUrl,
            trackCount = tracks.size,
            tracks = tracks,
        )
    }

    suspend fun album(id: String): AlbumWithTracks {
        val data = apiGet<JsonObject>("/albums/$id/with-tracks")
        val tracks = data["volumes"]?.jsonArray
            ?.flatMap { vol -> vol.jsonArray.mapNotNull { mapYandexTrack(it.jsonObject) } }
            ?: emptyList()
        val meta = mapYandexAlbum(data) ?: UnifiedAlbum(SourceId.YANDEX, id, "Альбом", "")
        val labels = data["labels"]?.jsonArray?.mapNotNull {
            it.jsonObject["name"]?.jsonPrimitive?.contentOrNull ?: it.jsonPrimitive.contentOrNull
        }?.joinToString()
        return AlbumWithTracks(
            source = meta.source,
            id = meta.id,
            title = meta.title,
            artist = meta.artist,
            artists = meta.artists,
            year = meta.year,
            coverUrl = meta.coverUrl,
            trackCount = tracks.size,
            type = meta.type,
            genre = meta.genre,
            tracks = tracks,
            label = labels,
            durationMs = tracks.sumOf { it.durationMs ?: 0 },
        )
    }

    suspend fun artistProfile(id: String): ArtistProfile {
        val brief = apiGet<JsonObject>("/artists/$id/brief-info")
        val artist = mapYandexArtist(brief["artist"]?.jsonObject ?: JsonObject(emptyMap()))
            ?: com.mss.core.model.UnifiedArtist(SourceId.YANDEX, id, "Исполнитель")
        val popular = brief["popularTracks"]?.jsonArray?.mapNotNull { mapYandexTrack(it.jsonObject) } ?: emptyList()
        val similar = brief["similarArtists"]?.jsonArray?.mapNotNull { mapYandexArtist(it.jsonObject) } ?: emptyList()
        val direct = runCatching {
            apiGet<JsonObject>("/artists/$id/direct-albums?page=0&page-size=100&sort-by=year")
        }.getOrNull()
        val releases = (direct?.get("albums")?.jsonArray ?: brief["albums"]?.jsonArray)
            ?.mapNotNull { mapYandexAlbum(it.jsonObject) }
            ?.sortedByDescending { it.year ?: 0 }
            ?: emptyList()
        return ArtistProfile(
            artist = artist,
            popularTracks = popular,
            albums = releases.filter { it.type != "single" },
            singles = releases.filter { it.type == "single" },
            similar = similar,
        )
    }

    override suspend fun savedTracks(limit: Int): List<UnifiedTrack> {
        val uid = userId()
        val data = apiGet<JsonObject>("/users/$uid/likes/tracks")
        val ids = data["library"]?.jsonObject?.get("tracks")?.jsonArray
            ?.mapNotNull { it.jsonObject["id"]?.jsonPrimitive?.content }
            ?: emptyList()
        return tracksByIds(ids.take(limit))
    }

    suspend fun setLike(track: UnifiedTrack, liked: Boolean) {
        val uid = userId()
        val action = if (liked) "add-multiple" else "remove"
        apiPostForm("/users/$uid/likes/tracks/$action", mapOf("track-ids" to trackKey(track)))
    }

    suspend fun dislike(track: UnifiedTrack) {
        val uid = userId()
        apiPostForm("/users/$uid/dislikes/tracks/add-multiple", mapOf("track-ids" to trackKey(track)))
    }

    suspend fun similarTracks(trackId: String): List<UnifiedTrack> {
        val data = apiGet<JsonObject>("/tracks/${encode(trackBaseId(trackId))}/similar")
        return data["similarTracks"]?.jsonArray?.mapNotNull { mapYandexTrack(it.jsonObject) } ?: emptyList()
    }

    suspend fun lyrics(trackId: String): TrackLyrics? {
        val baseId = trackBaseId(trackId)
        suspend fun load(format: String): Pair<String, List<String>?> {
            val (ts, sign) = signTrack(trackId)
            val info = apiGet<JsonObject>(
                "/tracks/${encode(baseId)}/lyrics?format=$format&timeStamp=$ts&sign=${encode(sign)}",
            )
            val url = info["downloadUrl"]?.jsonPrimitive?.content ?: throw ConnectorException("lyrics url")
            val text = http.get(url).bodyAsText()
            val writers = info["writers"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }
            return text to writers
        }
        runCatching {
            val (text, writers) = load("LRC")
            val lines = parseLrc(text)
            if (lines.isNotEmpty()) return TrackLyrics(true, lines, writers)
        }
        return runCatching {
            val (text, writers) = load("TEXT")
            TrackLyrics(false, text.split(Regex("\\r?\\n")).map { com.mss.core.model.LyricsLine(-1, it) }, writers)
        }.getOrNull()
    }

    suspend fun feed(): List<FeedBlock> {
        val data = apiGet<JsonObject>("/landing3?blocks=personalplaylists,new-releases,new-playlists,chart")
        return data["blocks"]?.jsonArray?.mapNotNull { blockEl ->
            val b = blockEl.jsonObject
            val items = b["entities"]?.jsonArray?.mapNotNull { toFeedItem(it.jsonObject) } ?: emptyList()
            if (items.isEmpty()) null
            else FeedBlock(
                id = b["id"]?.jsonPrimitive?.contentOrNull ?: b["type"]?.jsonPrimitive?.content.orEmpty(),
                title = b["title"]?.jsonPrimitive?.contentOrNull ?: "",
                items = items,
            )
        } ?: emptyList()
    }

    suspend fun chart(): List<UnifiedTrack> {
        val data = apiGet<JsonObject>("/landing3/chart")
        return data["chart"]?.jsonObject?.get("tracks")?.jsonArray
            ?.mapNotNull { it.jsonObject["track"]?.jsonObject?.let(::mapYandexTrack) }
            ?: emptyList()
    }

    fun currentWave(): WaveBatch? = radioSession

    suspend fun waveStart(settings: WaveSettings = WaveSettings()): WaveBatch {
        val seeds = mutableListOf(settings.seed ?: "user:onyourwave")
        settings.diversity?.let { seeds += "settingDiversity:$it" }
        settings.moodEnergy?.let { seeds += "settingMoodEnergy:$it" }
        settings.language?.let { seeds += "settingLanguage:$it" }
        val data = apiPostJson<JsonObject>(
            rotorPath("/rotor/session/new"),
            """{"seeds":${json.encodeToString(seeds)},"includeTracksInResponse":true}""",
        )
        val batch = parseWave(data, "")
        radioSession = batch
        runCatching { waveFeedback(batch.sessionId, batch.batchId, "radioStarted") }
        return batch
    }

    suspend fun waveMore(sessionId: String, queue: List<String>): WaveBatch {
        val data = apiPostJson<JsonObject>(
            rotorPath("/rotor/session/$sessionId/tracks"),
            """{"queue":${json.encodeToString(queue)}}""",
        )
        val batch = parseWave(data, sessionId)
        radioSession = batch
        return batch
    }

    suspend fun waveFeedback(
        sessionId: String,
        batchId: String,
        type: String,
        track: UnifiedTrack? = null,
        totalPlayedSeconds: Double? = null,
    ) {
        val event = buildString {
            append("""{"type":"$type","timestamp":"${java.time.Instant.now()}"""")
            if (track != null) append(""","trackId":"${trackKey(track)}"""")
            if (totalPlayedSeconds != null) append(""","totalPlayedSeconds":${totalPlayedSeconds.toInt()}""")
            append("}")
        }
        apiPostJson<JsonObject>(rotorPath("/rotor/session/$sessionId/feedback"), """{"event":$event,"batchId":"$batchId"}""")
    }

    suspend fun reportPlay(report: PlaybackReport) {
        val uid = userId()
        val now = java.time.Instant.now().toString()
        apiPostForm(
            "/play-audio",
            mapOf(
                "track-id" to trackBaseId(report.trackId),
                "album-id" to (report.albumId ?: ""),
                "from-cache" to "false",
                "from" to "mss-android",
                "play-id" to "",
                "uid" to uid,
                "timestamp" to now,
                "track-length-seconds" to report.trackLengthSeconds.toInt().toString(),
                "total-played-seconds" to report.totalPlayedSeconds.toInt().toString(),
                "end-position-seconds" to report.endPositionSeconds.toInt().toString(),
                "client-now" to now,
            ),
        )
    }

    override suspend fun resolvePlaybackUrl(track: UnifiedTrack): String {
        val trackId = trackBaseId(track.id)
        val ts = System.currentTimeMillis() / 1000
        val sign = YandexCrypto.signTrack(trackId, ts)
        val items = apiGet<JsonArray>(
            "/tracks/${encode(trackId)}/download-info?can_use_streaming=true&ts=$ts&sign=${encode(sign)}",
        )
        val entry = items.firstOrNull {
            val codec = it.jsonObject["codec"]?.jsonPrimitive?.content
            (codec == "mp3" || codec == "aac") && it.jsonObject["downloadInfoUrl"] != null
        } ?: throw ConnectorException("download-info: нет формата")
        val infoUrl = entry.jsonObject["downloadInfoUrl"]!!.jsonPrimitive.content
        val xml = http.get(infoUrl).bodyAsText()
        fun tag(name: String) = Regex("<$name>([^<]+)</$name>").find(xml)?.groupValues?.get(1)
        val host = tag("host") ?: throw ConnectorException("Yandex storage")
        val path = tag("path") ?: throw ConnectorException("Yandex storage")
        val s = tag("s") ?: throw ConnectorException("Yandex storage")
        val linkTs = tag("ts") ?: throw ConnectorException("Yandex storage")
        val signPath = YandexCrypto.signDirectLink(path.substringAfter("/get/"), s, linkTs)
        return "https://$host/get/$path/$signPath/$linkTs/mp3"
    }

    suspend fun tracksByIds(ids: List<String>): List<UnifiedTrack> {
        if (ids.isEmpty()) return emptyList()
        val out = mutableListOf<UnifiedTrack>()
        for (chunk in ids.chunked(200)) {
            val data = apiGet<JsonArray>("/tracks?track-ids=${chunk.joinToString(",")}")
            out += data.mapNotNull { mapYandexTrack(it.jsonObject) }
        }
        return out
    }

    private fun parseWave(data: JsonObject, sessionFallback: String): WaveBatch {
        val sessionId = data["radioSessionId"]?.jsonPrimitive?.contentOrNull ?: sessionFallback
        val batchId = data["batchId"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val tracks = data["sequence"]?.jsonArray
            ?.mapNotNull { it.jsonObject["track"]?.jsonObject }
            ?.mapNotNull { mapYandexTrack(it) }
            ?: emptyList()
        return WaveBatch(sessionId, batchId, tracks)
    }

    private fun toFeedItem(entity: JsonObject): FeedItem? {
        val type = entity["type"]?.jsonPrimitive?.contentOrNull ?: return null
        val data = entity["data"]?.jsonObject ?: return null
        return when (type) {
            "personal-playlist" -> data["data"]?.jsonObject?.let { FeedItem("playlist", playlist = mapYandexPlaylist(it)) }
            "playlist" -> FeedItem("playlist", playlist = mapYandexPlaylist(data))
            "album" -> mapYandexAlbum(data)?.let { FeedItem("album", album = it) }
            "chart-item" -> data["track"]?.jsonObject?.let { mapYandexTrack(it) }?.let { FeedItem("track", track = it) }
            else -> null
        }
    }

    private suspend fun rotorPath(path: String): String {
        val uid = userId()
        val sep = if (path.contains('?')) '&' else '?'
        return "$path${sep}uid=$uid"
    }

    private suspend fun userId(): String {
        vault.get(ACCOUNT_KEY)?.let { cached ->
            val uid = runCatching { json.decodeFromString<AccountCache>(cached).uid }.getOrNull()
            if (!uid.isNullOrBlank() && uid != "null") return uid
        }
        val data = apiGet<JsonObject>("/account/status")
        val uid = data["account"]?.jsonObject?.get("uid")?.jsonPrimitive?.content
            ?.takeIf { it.isNotBlank() && it != "null" }
            ?: throw ConnectorException(YandexErrors.SESSION)
        vault.set(ACCOUNT_KEY, json.encodeToString(AccountCache.serializer(), AccountCache(uid)))
        return uid
    }

    private fun signTrack(trackId: String): Pair<Long, String> {
        val ts = System.currentTimeMillis() / 1000
        return ts to YandexCrypto.signTrack(trackId, ts)
    }

    private suspend inline fun <reified T> apiPostJson(path: String, jsonBody: String): T = queueMutex.withLock {
        val token = accessToken()
        val res = http.post("https://api.music.yandex.net$path") {
            header(HttpHeaders.Authorization, "OAuth $token")
            header("X-Yandex-Music-Client", "YandexMusicAndroid/24023621")
            header("Accept-Language", "ru")
            contentType(ContentType.Application.Json)
            setBody(jsonBody)
        }
        unwrap(res.bodyAsText(), res.status.isSuccess(), res.status.value)
    }

    private suspend fun apiPostForm(path: String, fields: Map<String, String>) = queueMutex.withLock {
        val token = accessToken()
        val res = http.post("https://api.music.yandex.net$path") {
            header(HttpHeaders.Authorization, "OAuth $token")
            header("X-Yandex-Music-Client", "YandexMusicAndroid/24023621")
            contentType(ContentType.Application.FormUrlEncoded)
            setBody(FormDataContent(Parameters.build { fields.forEach { (k, v) -> append(k, v) } }))
        }
        val text = res.bodyAsText()
        if (!res.status.isSuccess()) failApi(res.status.value, text)
    }

    private suspend inline fun <reified T> apiGet(path: String): T = queueMutex.withLock {
        val token = accessToken()
        val res = http.get("https://api.music.yandex.net$path") {
            header(HttpHeaders.Authorization, "OAuth $token")
            header("X-Yandex-Music-Client", "YandexMusicAndroid/24023621")
            header("Accept-Language", "ru")
        }
        unwrap(res.bodyAsText(), res.status.isSuccess(), res.status.value)
    }

    private suspend inline fun <reified T> unwrap(text: String, ok: Boolean, status: Int): T {
        if (!ok) failApi(status, text)
        val parsed = json.parseToJsonElement(text)
        if (parsed is JsonObject && parsed.containsKey("result")) {
            return json.decodeFromString(parsed["result"]!!.toString())
        }
        return json.decodeFromString(text)
    }

    private suspend fun failApi(status: Int, text: String): Nothing {
        if (YandexErrors.isAuthFailure(status, text)) {
            vault.delete(VAULT_KEY)
            vault.delete(ACCOUNT_KEY)
        }
        throw ConnectorException(YandexErrors.message(status, text))
    }

    private suspend fun accessToken(): String {
        val t = loadTokens() ?: throw ConnectorException("Яндекс не подключён")
        if (t.clientId != clientId) {
            vault.delete(VAULT_KEY)
            vault.delete(ACCOUNT_KEY)
            throw ConnectorException(YandexErrors.SESSION)
        }
        if (System.currentTimeMillis() < t.expiresAt - 60_000) return t.accessToken
        val refresh = t.refreshToken ?: throw ConnectorException("Яндекс: нет refresh token")
        val token = oauthForm<YandexTokenResponse>(
            "https://oauth.yandex.ru/token",
            mapOf(
                "grant_type" to "refresh_token",
                "refresh_token" to refresh,
                "client_id" to clientId,
                "client_secret" to clientSecret,
            ),
        )
        val next = t.copy(
            accessToken = token.accessToken,
            refreshToken = token.refreshToken ?: refresh,
            expiresAt = System.currentTimeMillis() + token.expiresIn * 1000,
        )
        saveTokens(next)
        return next.accessToken
    }

    private suspend inline fun <reified T> oauthForm(url: String, fields: Map<String, String>): T {
        val res = http.post(url) {
            contentType(ContentType.Application.FormUrlEncoded)
            setBody(FormDataContent(Parameters.build { fields.forEach { (k, v) -> append(k, v) } }))
        }
        val body = res.bodyAsText()
        if (!res.status.isSuccess()) {
            val err = runCatching { json.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.content }.getOrNull()
            throw ConnectorException(err ?: body)
        }
        return json.decodeFromString(body)
    }

    private fun loadTokens(): YandexTokens? {
        val raw = vault.get(VAULT_KEY) ?: return null
        return json.decodeFromString(raw)
    }

    private fun saveTokens(t: YandexTokens) {
        vault.set(VAULT_KEY, json.encodeToString(YandexTokens.serializer(), t))
    }

    companion object {
        private const val VAULT_KEY = "yandex_tokens"
        private const val ACCOUNT_KEY = "yandex_account"
        const val MUSIC_CLIENT_ID = "23cabbbdc6cd418abb4b39c32c41195d"
        const val MUSIC_CLIENT_SECRET = "53bc75238f0c4d08a118e51fe9203300"
    }
}

@Serializable
private data class YandexTokens(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_at") val expiresAt: Long,
    @SerialName("client_id") val clientId: String,
)

@Serializable
private data class DeviceCodeResponse(
    @SerialName("device_code") val deviceCode: String,
    @SerialName("user_code") val userCode: String,
    @SerialName("verification_url") val verificationUrl: String,
    @SerialName("interval") val interval: Int,
    @SerialName("expires_in") val expiresIn: Int,
)

@Serializable
private data class YandexTokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String? = null,
    @SerialName("expires_in") val expiresIn: Int,
)

@Serializable
private data class AccountCache(val uid: String)

private fun encode(v: String) = java.net.URLEncoder.encode(v, Charsets.UTF_8)

private fun randomHex(bytes: Int): String {
    val buf = ByteArray(bytes)
    java.security.SecureRandom().nextBytes(buf)
    return buf.joinToString("") { "%02x".format(it) }
}

