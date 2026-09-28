package com.mss.core.connectors

import com.mss.core.datastore.TokenVault
import com.mss.core.model.DeviceCodePrompt
import com.mss.core.model.SourceId
import com.mss.core.model.UnifiedPlaylist
import com.mss.core.model.UnifiedTrack
import io.ktor.client.HttpClient
import io.ktor.client.call.body
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
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

@Singleton
class YandexConnector @Inject constructor(
    private val vault: TokenVault,
) : StreamConnector {
    override val id = SourceId.YANDEX
    override val displayName = "Яндекс Музыка"

    private val clientId = BuildConfig.YANDEX_CLIENT_ID
    private val clientSecret = BuildConfig.YANDEX_CLIENT_SECRET
    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient(OkHttp)
    private val queueMutex = Mutex()
    private val loginAbort = AtomicReference(false)

    private var pendingPrompt: DeviceCodePrompt? = null

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
        return results.mapNotNull { parseYandexTrack(it.jsonObject) }
    }

    override suspend fun listPlaylists(): List<UnifiedPlaylist> {
        val uid = userId()
        val own = apiGet<List<JsonObject>>("/users/$uid/playlists/list")
        return own.map { pl ->
            UnifiedPlaylist(
                source = SourceId.YANDEX,
                id = "${pl["owner"]?.jsonObject?.get("uid")?.jsonPrimitive?.content}:${pl["kind"]?.jsonPrimitive?.content}",
                title = pl["title"]?.jsonPrimitive?.content ?: "Плейлист",
                owner = pl["owner"]?.jsonObject?.get("name")?.jsonPrimitive?.content,
                trackCount = pl["trackCount"]?.jsonPrimitive?.content?.toIntOrNull(),
                coverUrl = pl["cover"]?.jsonObject?.get("uri")?.jsonPrimitive?.content?.let { "https://$it" },
            )
        }
    }

    override suspend fun savedTracks(limit: Int): List<UnifiedTrack> {
        val uid = userId()
        val data = apiGet<JsonObject>("/users/$uid/likes/tracks")
        val ids = data["library"]?.jsonObject?.get("tracks")?.jsonArray
            ?.mapNotNull { it.jsonObject["id"]?.jsonPrimitive?.content }
            ?: emptyList()
        return tracksByIds(ids.take(limit))
    }

    override suspend fun resolvePlaybackUrl(track: UnifiedTrack): String {
        val trackId = track.id.substringBefore(':')
        val ts = System.currentTimeMillis() / 1000
        val sign = hmacBase64(ANDROID_SIGN_KEY, "$trackId$ts")
        val items = apiGet<List<JsonObject>>(
            "/tracks/${encode(trackId)}/download-info?can_use_streaming=true&ts=$ts&sign=${encode(sign)}",
        )
        val entry = items.firstOrNull {
            val codec = it["codec"]?.jsonPrimitive?.content
            (codec == "mp3" || codec == "aac") && it["downloadInfoUrl"] != null
        } ?: throw ConnectorException("download-info: нет формата")
        val infoUrl = entry["downloadInfoUrl"]!!.jsonPrimitive.content
        val xml = http.get(infoUrl).bodyAsText()
        fun tag(name: String) = Regex("<$name>([^<]+)</$name>").find(xml)?.groupValues?.get(1)
        val host = tag("host") ?: throw ConnectorException("Yandex storage")
        val path = tag("path") ?: throw ConnectorException("Yandex storage")
        val s = tag("s") ?: throw ConnectorException("Yandex storage")
        val linkTs = tag("ts") ?: throw ConnectorException("Yandex storage")
        val signPath = hmacHex(DIRECT_LINK_SALT, DIRECT_LINK_SALT + path.substringAfter("/get/") + s + linkTs)
        return "https://$host/get/$path/$signPath/$linkTs/mp3"
    }

    suspend fun tracksByIds(ids: List<String>): List<UnifiedTrack> {
        if (ids.isEmpty()) return emptyList()
        val joined = ids.joinToString(",")
        val data = apiGet<List<JsonObject>>("/tracks?track-ids=$joined")
        return data.mapNotNull { parseYandexTrack(it) }
    }

    suspend fun similarTracks(trackId: String): List<UnifiedTrack> {
        val baseId = trackId.substringBefore(':')
        val data = apiGet<JsonObject>("/tracks/${encode(baseId)}/similar")
        val arr = data["similarTracks"]?.jsonArray ?: return emptyList()
        return arr.mapNotNull { parseYandexTrack(it.jsonObject) }
    }

    suspend fun waveStart(): WaveBatch {
        val data = apiPost<JsonObject>(
            "/rotor/session/new",
            """{"seeds":["user:onyourwave"],"includeTracksInResponse":true}""",
        )
        return parseWaveBatch(data, "")
    }

    private fun parseWaveBatch(data: JsonObject, sessionFallback: String): WaveBatch {
        val sessionId = data["radioSessionId"]?.jsonPrimitive?.content ?: sessionFallback
        val batchId = data["batchId"]?.jsonPrimitive?.content ?: ""
        val tracks = data["sequence"]?.jsonArray
            ?.mapNotNull { it.jsonObject["track"]?.jsonObject }
            ?.mapNotNull { parseYandexTrack(it) }
            ?: emptyList()
        return WaveBatch(sessionId, batchId, tracks)
    }

    private suspend fun userId(): String {
        vault.get(ACCOUNT_KEY)?.let { return Json.decodeFromString<AccountCache>(it).uid }
        val data = apiGet<JsonObject>("/account/status")
        val uid = data["account"]?.jsonObject?.get("uid")?.jsonPrimitive?.content
            ?: throw ConnectorException("Не удалось определить uid")
        vault.set(ACCOUNT_KEY, Json.encodeToString(AccountCache.serializer(), AccountCache(uid)))
        return uid
    }

    private suspend inline fun <reified T> apiPost(path: String, jsonBody: String): T = queueMutex.withLock {
        val token = accessToken()
        val res = http.post("https://api.music.yandex.net$path") {
            header(HttpHeaders.Authorization, "OAuth $token")
            header("X-Yandex-Music-Client", "YandexMusicAndroid/24023621")
            header("Accept-Language", "ru")
            contentType(ContentType.Application.Json)
            setBody(jsonBody)
        }
        val text = res.bodyAsText()
        if (!res.status.isSuccess()) throw ConnectorException("Yandex API ${res.status.value}: ${text.take(200)}")
        val parsed = json.parseToJsonElement(text)
        if (parsed is JsonObject && parsed.containsKey("result")) {
            return json.decodeFromString<T>(parsed["result"]!!.toString())
        }
        return json.decodeFromString(text)
    }

    private suspend inline fun <reified T> apiGet(path: String): T = queueMutex.withLock {
        val token = accessToken()
        val res = http.get("https://api.music.yandex.net$path") {
            header(HttpHeaders.Authorization, "OAuth $token")
            header("X-Yandex-Music-Client", "YandexMusicAndroid/24023621")
            header("Accept-Language", "ru")
        }
        val body = res.bodyAsText()
        if (!res.status.isSuccess()) throw ConnectorException("Yandex API ${res.status.value}: ${body.take(200)}")
        val parsed = json.parseToJsonElement(body)
        if (parsed is JsonObject && parsed.containsKey("result")) {
            return json.decodeFromString<T>(parsed["result"]!!.toString())
        }
        return json.decodeFromString(body)
    }

    private suspend fun accessToken(): String {
        val t = loadTokens() ?: throw ConnectorException("Яндекс не подключён")
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

    private fun parseYandexTrack(obj: JsonObject): UnifiedTrack? {
        val id = obj["id"]?.jsonPrimitive?.content ?: return null
        val title = obj["title"]?.jsonPrimitive?.content ?: return null
        val artists = obj["artists"]?.jsonArray?.joinToString { it.jsonObject["name"]?.jsonPrimitive?.content ?: "" }
            ?: "Неизвестный"
        return UnifiedTrack(
            source = SourceId.YANDEX,
            id = id,
            title = title,
            artist = artists,
            album = obj["albums"]?.jsonArray?.firstOrNull()?.jsonObject?.get("title")?.jsonPrimitive?.content,
            durationMs = obj["durationMs"]?.jsonPrimitive?.content?.toLongOrNull(),
            coverUrl = obj["coverUri"]?.jsonPrimitive?.content?.let { "https://$it/200x200" },
            playable = true,
        )
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
        private const val ANDROID_SIGN_KEY = "p93jhgh689SBReK6ghtw62"
        private const val DIRECT_LINK_SALT = "XGRlBW9FXlekgbPrRHuSiA"
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

data class WaveBatch(
    val sessionId: String,
    val batchId: String,
    val tracks: List<UnifiedTrack>,
)

private fun encode(v: String) = java.net.URLEncoder.encode(v, Charsets.UTF_8)

private fun randomHex(bytes: Int): String {
    val buf = ByteArray(bytes)
    java.security.SecureRandom().nextBytes(buf)
    return buf.joinToString("") { "%02x".format(it) }
}

private fun hmacBase64(key: String, data: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA256"))
    return android.util.Base64.encodeToString(mac.doFinal(data.toByteArray()), android.util.Base64.NO_WRAP)
}

private fun hmacHex(key: String, data: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA256"))
    return mac.doFinal(data.toByteArray()).joinToString("") { "%02x".format(it) }
}
