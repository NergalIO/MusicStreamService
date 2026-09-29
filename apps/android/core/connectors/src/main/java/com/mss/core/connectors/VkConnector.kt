package com.mss.core.connectors

import com.mss.core.datastore.TokenVault
import com.mss.core.model.ArtistRef
import com.mss.core.model.ExternalAccount
import com.mss.core.model.PlaylistWithTracks
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedArtist
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Parameters
import io.ktor.http.contentType
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.delay
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

@Singleton
class VkConnector @Inject constructor(
    private val vault: TokenVault,
) : StreamConnector {
    override val id = SourceId.VK
    override val displayName = "VK Музыка"

    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient(OkHttp)

    override fun authStatus(): AuthStatus {
        return if (loadTokens() != null) AuthStatus.CONNECTED else AuthStatus.DISCONNECTED
    }

    private var smsSession: VkIdSession? = null
    private var smsSid: String = ""
    private var smsPhone: String = ""
    private var passwordCaptchaSid: String? = null

    private fun deviceId(): String {
        vault.get(DEVICE_KEY)?.let { return it }
        val id = java.util.UUID.randomUUID().toString()
        vault.set(DEVICE_KEY, id)
        return id
    }

    fun vkIdLoginUrl(): String = VkAuth.ID_LOGIN

    suspend fun loginWithPassword(
        username: String,
        password: String,
        code: String? = null,
        captchaKey: String? = null,
    ) {
        val extra = mutableMapOf<String, String>()
        if (!code.isNullOrBlank()) extra["code"] = code
        if (passwordCaptchaSid != null && !captchaKey.isNullOrBlank()) {
            extra["captcha_sid"] = passwordCaptchaSid!!
            extra["captcha_key"] = captchaKey
        }
        try {
            val pair = VkAuth.loginPassword(username.trim(), password, extra)
            passwordCaptchaSid = null
            saveTokens(VkTokens(pair.accessToken, pair.userId))
        } catch (e: VkAuthException) {
            passwordCaptchaSid = e.captchaSid
            throw e
        }
    }

    suspend fun startSms(phone: String, captchaSid: String? = null, captchaKey: String? = null): String {
        val normalized = VkAuth.normalizePhone(phone)
        if (normalized.isBlank()) throw VkAuthException("Введите номер телефона")
        val session = smsSession ?: VkAuth.startIdSession().also { smsSession = it }
        val (sid, mask) = VkAuth.validatePhone(session, normalized, deviceId(), captchaSid, captchaKey)
        smsSid = sid
        smsPhone = normalized
        return mask
    }

    suspend fun confirmSms(code: String) {
        val session = smsSession ?: throw VkAuthException("Начните вход по SMS заново")
        if (smsSid.isBlank() || smsPhone.isBlank()) throw VkAuthException("Начните вход по SMS заново")
        val pair = VkAuth.confirmSms(session, smsPhone, smsSid, code.trim(), deviceId())
        smsSession = null
        smsSid = ""
        saveTokens(VkTokens(pair.accessToken, pair.userId))
    }

    fun cancelLogin() {
        smsSession = null
        smsSid = ""
        smsPhone = ""
        passwordCaptchaSid = null
    }

    suspend fun completeWebLogin(url: String) {
        val payload = VkAuth.parseOAuthRedirect(url) ?: throw VkAuthException("VK не вернул токен")
        val pair = VkAuth.materialize(payload)
        saveTokens(VkTokens(pair.accessToken, pair.userId))
    }

    /** Cookies из WebView после входа на id.vk.com. false — сессии ещё нет, окно не закрываем. */
    suspend fun completeWebLoginFromCookies(cookieHeader: String): Boolean {
        val cookies = VkAuth.parseCookieHeader(cookieHeader)
        if (cookies.isEmpty()) return false
        val payload = VkAuth.tokensFromConnectInternal(cookies, VkAuth.KATE_CLIENT_ID)
            ?: VkAuth.tokensFromConnectInternal(cookies, VkAuth.ANDROID_CLIENT_ID)
            ?: return false
        val pair = VkAuth.materialize(payload)
        saveTokens(VkTokens(pair.accessToken, pair.userId))
        return true
    }

    override suspend fun disconnect() {
        vault.delete(VAULT_KEY)
        vault.delete(ACCOUNT_KEY)
    }

    suspend fun account(): ExternalAccount? {
        val t = loadTokens() ?: return null
        return ExternalAccount(uid = t.userId.toString(), displayName = t.userId.toString(), hasPlus = false)
    }

    override suspend fun search(query: String, limit: Int): List<UnifiedTrack> {
        val page = call("audio.search", mapOf("q" to query, "count" to minOf(limit, 300).toString(), "auto_complete" to "1", "sort" to "2"))
        return audioItems(page).take(limit).map { mapVkTrack(it) }
    }

    suspend fun searchArtists(query: String, limit: Int): List<UnifiedArtist> {
        val page = call("audio.search", mapOf("q" to query, "count" to minOf(limit * 8, 200).toString(), "auto_complete" to "1"))
        val seen = linkedMapOf<String, UnifiedArtist>()
        for (a in audioItems(page)) {
            val arts = a["main_artists"]?.jsonArray ?: continue
            for (art in arts) {
                val o = art.jsonObject
                val name = o["name"]?.jsonPrimitive?.contentOrNull ?: continue
                val id = o["id"]?.jsonPrimitive?.contentOrNull ?: name
                if (id !in seen) seen[id] = UnifiedArtist(SourceId.VK, id, name)
                if (seen.size >= limit) return seen.values.toList()
            }
        }
        return seen.values.toList()
    }

    override suspend fun listPlaylists(): List<UnifiedPlaylist> {
        val owner = loadTokens()?.userId ?: return emptyList()
        val out = mutableListOf<UnifiedPlaylist>()
        var offset = 0
        while (true) {
            val page = call("audio.getPlaylists", mapOf("owner_id" to owner.toString(), "offset" to offset.toString(), "count" to "100"))
            val items = page["items"]?.jsonArray ?: break
            out += items.map { mapVkPlaylist(it.jsonObject) }
            if (items.isEmpty() || out.size >= (page["count"]?.jsonPrimitive?.intOrNull ?: out.size)) break
            offset += items.size
        }
        return out
    }

    suspend fun playlist(id: String): PlaylistWithTracks {
        val (ownerId, playlistId, accessKey) = parseVkId(id)
        val tracks = collectAudio(
            mapOf(
                "owner_id" to ownerId.toString(),
                "playlist_id" to playlistId.toString(),
                "access_key" to (accessKey ?: ""),
            ),
            2000,
        ).map { mapVkTrack(it) }
        val meta = runCatching {
            call(
                "audio.getPlaylistById",
                mapOf(
                    "owner_id" to ownerId.toString(),
                    "playlist_id" to playlistId.toString(),
                    "access_key" to (accessKey ?: ""),
                ),
            )
        }.getOrNull()
        val title = meta?.get("title")?.jsonPrimitive?.contentOrNull ?: "Плейлист"
        return PlaylistWithTracks(SourceId.VK, id, title, tracks = tracks, trackCount = tracks.size)
    }

    override suspend fun savedTracks(limit: Int): List<UnifiedTrack> {
        val owner = loadTokens()?.userId
        val params = if (owner != null) mapOf("owner_id" to owner.toString()) else emptyMap()
        return collectAudio(params, limit).map { mapVkTrack(it) }
    }

    suspend fun artistTracks(artistId: String, artistName: String?, limit: Int): List<UnifiedTrack> {
        val direct = runCatching {
            call("audio.getAudiosByArtist", mapOf("artist_id" to artistId, "count" to minOf(limit, 300).toString()))
        }.getOrNull()
        val items = direct?.let { audioItems(it) }.orEmpty()
        if (items.isNotEmpty()) return items.take(limit).map { mapVkTrack(it) }
        val q = artistName ?: artistId
        return search(q, limit)
    }

    override suspend fun resolvePlaybackUrl(track: UnifiedTrack): String {
        val (owner, audio, access) = parseVkId(track.id)
        val audios = if (access != null) "${owner}_${audio}_$access" else "${owner}_$audio"
        val arr = callArray("audio.getById", mapOf("audios" to audios))
        val audioObj = unwrapAudio(arr.firstOrNull()?.let { if (it is JsonObject) it else null } ?: JsonObject(emptyMap()))
        val url = audioObj?.get("url")?.jsonPrimitive?.contentOrNull
            ?: throw ConnectorException("VK не отдал ссылку на поток")
        return url
    }

    private suspend fun collectAudio(params: Map<String, String>, limit: Int): List<JsonObject> {
        val items = mutableListOf<JsonObject>()
        var offset = 0
        while (items.size < limit) {
            val page = call("audio.get", params + mapOf("offset" to offset.toString(), "count" to minOf(200, limit - items.size).toString()))
            val batch = audioItems(page)
            items += batch
            if (batch.isEmpty()) break
            offset += batch.size
            if (items.size >= (page["count"]?.jsonPrimitive?.intOrNull ?: items.size)) break
        }
        return items.take(limit)
    }

    private fun audioItems(page: JsonObject): List<JsonObject> =
        (page["items"]?.jsonArray ?: JsonArray(emptyList())).mapNotNull { el ->
            val o = if (el is JsonObject) el else return@mapNotNull null
            unwrapAudio(o)
        }.filter { !isStub(it) }

    private fun unwrapAudio(item: JsonObject): JsonObject? {
        if (item.containsKey("title") && item.containsKey("owner_id")) return item
        return item["audio"]?.jsonObject
    }

    private fun isStub(a: JsonObject): Boolean {
        val title = a["title"]?.jsonPrimitive?.contentOrNull.orEmpty().lowercase()
        val artist = a["artist"]?.jsonPrimitive?.contentOrNull.orEmpty().lowercase()
        return title.contains("доступно на vk.com") || artist.contains("официальных приложениях")
    }

    private fun mapVkTrack(a: JsonObject): UnifiedTrack {
        val owner = a["owner_id"]?.jsonPrimitive?.content.orEmpty()
        val id = a["id"]?.jsonPrimitive?.content.orEmpty()
        val access = a["access_key"]?.jsonPrimitive?.contentOrNull
        val artists = a["main_artists"]?.jsonArray?.mapNotNull {
            val o = it.jsonObject
            val name = o["name"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            ArtistRef(o["id"]?.jsonPrimitive?.contentOrNull ?: name, name)
        }.orEmpty()
        val album = a["album"]?.jsonObject
        val restricted = a["content_restricted"]?.jsonPrimitive?.intOrNull == 1
        val url = a["url"]?.jsonPrimitive?.contentOrNull
        return UnifiedTrack(
            source = SourceId.VK,
            id = if (access != null) "${owner}_${id}_$access" else "${owner}_$id",
            title = a["title"]?.jsonPrimitive?.contentOrNull ?: "Без названия",
            artist = artists.joinToString { it.name }.ifBlank { a["artist"]?.jsonPrimitive?.contentOrNull ?: "Unknown" },
            artists = artists.takeIf { it.isNotEmpty() },
            album = album?.get("title")?.jsonPrimitive?.contentOrNull,
            albumId = album?.get("id")?.jsonPrimitive?.contentOrNull,
            durationMs = a["duration"]?.jsonPrimitive?.longOrNull?.times(1000),
            coverUrl = album?.get("thumb")?.jsonObject?.let { thumb ->
                listOf("photo_600", "photo_300", "photo_135").firstNotNullOfOrNull { thumb[it]?.jsonPrimitive?.contentOrNull }
            },
            playable = !restricted && !url.isNullOrBlank(),
            streamUrl = url,
        )
    }

    private fun mapVkPlaylist(p: JsonObject): UnifiedPlaylist {
        val owner = p["owner_id"]?.jsonPrimitive?.content.orEmpty()
        val id = p["id"]?.jsonPrimitive?.content.orEmpty()
        val access = p["access_key"]?.jsonPrimitive?.contentOrNull
        return UnifiedPlaylist(
            source = SourceId.VK,
            id = if (access != null) "${owner}_${id}_$access" else "${owner}_$id",
            title = p["title"]?.jsonPrimitive?.contentOrNull ?: "Плейлист",
            description = p["description"]?.jsonPrimitive?.contentOrNull,
            coverUrl = p["photo"]?.jsonObject?.let { thumb ->
                listOf("photo_600", "photo_300", "photo_135").firstNotNullOfOrNull { thumb[it]?.jsonPrimitive?.contentOrNull }
            },
            trackCount = p["count"]?.jsonPrimitive?.intOrNull,
        )
    }

    private fun parseVkId(id: String): Triple<Long, Long, String?> {
        val parts = id.split("_")
        val access = if (parts.size > 2) parts.drop(2).joinToString("_") else null
        return Triple(parts.getOrNull(0)?.toLongOrNull() ?: 0, parts.getOrNull(1)?.toLongOrNull() ?: 0, access)
    }

    private suspend fun call(method: String, params: Map<String, String>): JsonObject {
        val t = loadTokens() ?: throw ConnectorException("Войдите во VK")
        var last: ConnectorException? = null
        repeat(4) { attempt ->
            delay(if (attempt == 0) 0 else 400L * attempt)
            val body = Parameters.build {
                append("access_token", t.accessToken)
                append("v", API_VERSION)
                params.forEach { (k, v) -> if (v.isNotBlank()) append(k, v) }
            }
            val res = http.post("https://api.vk.com/method/$method") {
                header("User-Agent", KATE_UA)
                header("X-Requested-With", "com.perm.kate_new_6")
                contentType(ContentType.Application.FormUrlEncoded)
                setBody(FormDataContent(body))
            }
            val text = res.bodyAsText()
            val obj = json.parseToJsonElement(text).jsonObject
            val err = obj["error"]?.jsonObject
            if (err != null) {
                val code = err["error_code"]?.jsonPrimitive?.intOrNull ?: 0
                val msg = err["error_msg"]?.jsonPrimitive?.contentOrNull ?: "VK error"
                if (code == 6 || code == 9) {
                    last = ConnectorException(msg)
                    return@repeat
                }
                if (code == 5) {
                    disconnect()
                    throw ConnectorException("Сессия VK истекла — войдите заново")
                }
                throw ConnectorException(msg)
            }
            val response = obj["response"] ?: throw ConnectorException("Пустой ответ VK")
            return if (response is JsonObject) response else JsonObject(mapOf("items" to response))
        }
        throw last ?: ConnectorException("VK API")
    }

    private suspend fun callArray(method: String, params: Map<String, String>): List<kotlinx.serialization.json.JsonElement> {
        val t = loadTokens() ?: throw ConnectorException("Войдите во VK")
        val body = Parameters.build {
            append("access_token", t.accessToken)
            append("v", API_VERSION)
            params.forEach { (k, v) -> if (v.isNotBlank()) append(k, v) }
        }
        val res = http.post("https://api.vk.com/method/$method") {
            header("User-Agent", KATE_UA)
            header("X-Requested-With", "com.perm.kate_new_6")
            contentType(ContentType.Application.FormUrlEncoded)
            setBody(FormDataContent(body))
        }
        val obj = json.parseToJsonElement(res.bodyAsText()).jsonObject
        obj["error"]?.let { throw ConnectorException(it.toString()) }
        return obj["response"]?.jsonArray?.toList() ?: emptyList()
    }

    private fun loadTokens(): VkTokens? {
        val raw = vault.get(VAULT_KEY) ?: return null
        return json.decodeFromString(raw)
    }

    private fun saveTokens(t: VkTokens) {
        vault.set(VAULT_KEY, json.encodeToString(VkTokens.serializer(), t))
    }

    companion object {
        private const val VAULT_KEY = "vk_tokens"
        private const val ACCOUNT_KEY = "vk_account"
        private const val DEVICE_KEY = "vk_device_id"
        private const val API_VERSION = "5.131"
        private const val KATE_UA = VkAuth.KATE_UA
    }
}

@Serializable
private data class VkTokens(
    @SerialName("access_token") val accessToken: String,
    @SerialName("user_id") val userId: Long,
)
