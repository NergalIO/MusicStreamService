package com.mss.core.connectors

import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.request.forms.FormDataContent
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.request.url
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.Parameters
import io.ktor.http.contentType
import java.util.UUID
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

data class VkOAuthPayload(
    val accessToken: String? = null,
    val userId: Long? = null,
    val silentToken: String? = null,
    val uuid: String? = null,
)

data class VkIdSession(
    val uuid: String,
    val anonymousToken: String,
    val authToken: String,
    val cookies: MutableMap<String, String>,
)

data class VkTokenPair(val accessToken: String, val userId: Long)

object VkAuth {
    const val KATE_CLIENT_ID = "2685278"
    const val KATE_CLIENT_SECRET = "lxhD8OD7dMsqtXIm5IUAGS6Ok4UIAK"
    const val KATE_UA = "KateMobileAndroid/56 lite-5474 (Android 9; SDK 28; arm64-v8a; Google Pixel 3; ru)"
    const val ANDROID_CLIENT_ID = "2274003"
    const val ANDROID_CLIENT_SECRET = "hHbZxrka2uZ6jB1inYsH"
    const val AUTH_API = "5.207"
    const val API = "5.131"
    const val SCOPE = "audio,offline,friends,groups,status,wall,photos,video,docs,notes,pages,stats,notifications,messages"
    const val KATE_SCOPE_ALL = "1073737727"
    const val BROWSER_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
    const val ID_LOGIN = "https://id.vk.com/"
    const val MOBILE_UA =
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36"

    /** Мобильная страница входа: SMS-поле на ширине экрана. Kate в вебе отвечает «direct auth». */
    fun mobileAuthorizeUrl(): String {
        val redirect = java.net.URLEncoder.encode("https://oauth.vk.com/blank.html", Charsets.UTF_8)
        return "https://oauth.vk.com/authorize?client_id=$ANDROID_CLIENT_ID&scope=all" +
            "&redirect_uri=$redirect&display=mobile&response_type=token&revoke=1&v=$AUTH_API"
    }

    private val json = Json { ignoreUnknownKeys = true }
    private val http = HttpClient(OkHttp) {
        engine {
            config {
                followRedirects(false)
                followSslRedirects(false)
            }
        }
        expectSuccess = false
    }

    fun normalizePhone(input: String): String {
        val trimmed = input.trim()
        val digits = trimmed.filter { it.isDigit() }
        if (digits.isEmpty()) return ""
        if (digits.length == 11 && digits.startsWith("8")) return "+7${digits.substring(1)}"
        if (digits.length == 11 && digits.startsWith("7")) return "+$digits"
        if (digits.length == 10) return "+7$digits"
        return if (trimmed.startsWith("+")) "+$digits" else "+$digits"
    }

    fun otpAlreadySent(verification: String): Boolean =
        Regex("^(sms|otp|call|callreset|push)").containsMatchIn(verification.lowercase())

    fun parseOAuthRedirect(url: String): VkOAuthPayload? {
        val parsed = try {
            java.net.URI(url)
        } catch (_: Exception) {
            return null
        }
        val host = parsed.host.orEmpty()
        if (!host.matches(Regex("oauth\\.vk\\.(com|ru)", RegexOption.IGNORE_CASE))) return null
        if (parsed.path?.contains("blank.html") != true) return null
        val params = queryMap(parsed.rawQuery) + queryMap(parsed.rawFragment)
        params["error"]?.let { err ->
            val desc = params["error_description"] ?: err
            if (desc.contains("direct auth", true) || desc.contains("incorrect app", true)) {
                throw VkAuthException("VK не разрешает этот способ входа. Войдите по SMS или паролю")
            }
            throw VkAuthException(desc.replace('+', ' '))
        }
        params["payload"]?.let { raw ->
            val payload = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrNull()
            if (payload != null) {
                val silent = payload.str("token")
                val access = payload.str("access_token")
                val uuid = payload.str("uuid")
                val userId = payload["user_id"]?.jsonPrimitive?.longOrNull
                if (!silent.isNullOrBlank() || !access.isNullOrBlank()) {
                    return VkOAuthPayload(access, userId, silent, uuid)
                }
            }
        }
        val access = params["access_token"]
        val silent = params["silent_token"]
        val userId = params["user_id"]?.toLongOrNull()
        if (access.isNullOrBlank() && silent.isNullOrBlank()) return null
        return VkOAuthPayload(access, userId, silent, params["uuid"])
    }

    fun oauthRedirectError(url: String): String? = try {
        parseOAuthRedirect(url)
        null
    } catch (e: VkAuthException) {
        e.message
    }

    /** Путь `/blank.html`, а не `redirect_uri=...blank.html` в query authorize. */
    fun isOAuthBlankUrl(url: String): Boolean {
        val parsed = try {
            java.net.URI(url)
        } catch (_: Exception) {
            return false
        }
        val host = parsed.host.orEmpty()
        if (!host.matches(Regex("oauth\\.vk\\.(com|ru)", RegexOption.IGNORE_CASE))) return false
        return parsed.path?.contains("blank.html") == true
    }

    fun shouldCompleteWebLogin(url: String): Boolean {
        if (!isOAuthBlankUrl(url)) return false
        return try {
            parseOAuthRedirect(url) != null
        } catch (e: VkAuthException) {
            val msg = e.message.orEmpty()
            !msg.contains("не разрешает", true) && !msg.contains("direct auth", true)
        }
    }

    fun isVkHost(host: String): Boolean =
        host.matches(Regex("(?:(?:m|id|login|oauth|qr)\\.)?vk\\.(com|ru)", RegexOption.IGNORE_CASE))

    fun looksLoggedIn(url: String): Boolean {
        val parsed = try {
            java.net.URI(url)
        } catch (_: Exception) {
            return false
        }
        val host = parsed.host.orEmpty()
        if (!isVkHost(host)) return false
        if (host.contains("oauth.vk", true) || host.contains("qr.vk", true)) return false
        val path = parsed.path.orEmpty()
        return !path.contains("/login", true) && !path.contains("/auth", true)
    }

    fun parseCookieHeader(header: String): MutableMap<String, String> {
        val out = mutableMapOf<String, String>()
        header.split(';').forEach { part ->
            val eq = part.indexOf('=')
            if (eq <= 0) return@forEach
            val name = part.substring(0, eq).trim()
            val value = part.substring(eq + 1).trim()
            if (name.isNotBlank() && value.isNotBlank() && value != "DELETED") out[name] = value
        }
        return out
    }

    fun hasSessionCookie(header: String): Boolean {
        return parseCookieHeader(header).keys.any { name ->
            val n = name.lowercase()
            n.contains("remix") && (n.contains("sid") || n.contains("token") || n.contains("stlid"))
        }
    }

    fun parsePageTokens(html: String): VkOAuthPayload? {
        val access = Regex("\"(?:apiPrefetchToken|access_token|accessToken)\"\\s*:\\s*\"(vk1\\.[^\"]+)\"")
            .find(html)?.groupValues?.get(1)
        val silent = Regex("\"(?:silent_token|silentToken)\"\\s*:\\s*\"([^\"]{16,})\"")
            .find(html)?.groupValues?.get(1)
        val uuid = Regex("\"(?:silent_token_uuid|uuid)\"\\s*:\\s*\"([0-9a-f-]{16,})\"", RegexOption.IGNORE_CASE)
            .find(html)?.groupValues?.get(1)
        if (access.isNullOrBlank() && silent.isNullOrBlank()) return null
        return VkOAuthPayload(access, null, silent, uuid)
    }

    fun toRedirectUrl(payload: VkOAuthPayload): String {
        val parts = mutableListOf<String>()
        fun add(key: String, value: String?) {
            if (!value.isNullOrBlank()) parts += "$key=${encode(value)}"
        }
        add("access_token", payload.accessToken)
        add("silent_token", payload.silentToken)
        add("uuid", payload.uuid)
        payload.userId?.let { parts += "user_id=$it" }
        return "https://oauth.vk.com/blank.html#${parts.joinToString("&")}"
    }

    suspend fun tokensFromConnectInternal(
        cookies: Map<String, String>,
        appId: String,
        ua: String = MOBILE_UA,
    ): VkOAuthPayload? {
        if (cookies.isEmpty()) return null
        val obj = runCatching {
            postForm(
                "https://login.vk.com/?act=connect_internal",
                mapOf("app_id" to appId, "oauth_version" to "1", "version" to "1"),
                cookies = cookies.toMutableMap(),
                ua = ua,
                origin = "https://id.vk.com",
            )
        }.getOrNull() ?: return null
        val nested = obj["data"]?.jsonObject ?: obj
        val access = nested.str("access_token")
        val silent = nested.str("silent_token")
        if (access.isNullOrBlank() && silent.isNullOrBlank()) return null
        return VkOAuthPayload(
            accessToken = access,
            userId = nested["user_id"]?.jsonPrimitive?.longOrNull ?: nested.str("user_id")?.toLongOrNull(),
            silentToken = silent,
            uuid = nested.str("uuid") ?: nested.str("silent_token_uuid"),
        )
    }

    suspend fun loginPassword(
        username: String,
        password: String,
        extra: Map<String, String> = emptyMap(),
    ): VkTokenPair {
        val params = mutableMapOf(
            "grant_type" to "password",
            "client_id" to KATE_CLIENT_ID,
            "client_secret" to KATE_CLIENT_SECRET,
            "username" to username,
            "password" to password,
            "scope" to SCOPE,
            "2fa_supported" to "1",
            "v" to API,
        )
        extra.forEach { (k, v) -> if (v.isNotBlank()) params[k] = v }
        val obj = postForm("https://oauth.vk.com/token", params, kate = true)
        obj.str("access_token")?.let { token ->
            val userId = obj["user_id"]?.jsonPrimitive?.longOrNull
                ?: throw VkAuthException("VK не вернул пользователя")
            return VkTokenPair(token, userId)
        }
        when (obj.str("error")) {
            "need_captcha" -> throw VkAuthException(
                "Введите код с картинки",
                captchaSid = obj.str("captcha_sid"),
                captchaImg = obj.str("captcha_img"),
            )
            "need_validation" -> throw VkAuthException(
                obj.str("error_description") ?: "Введите код подтверждения",
                need2fa = true,
                phoneMask = obj.str("phone_mask"),
            )
        }
        throw VkAuthException(passwordError(obj))
    }

    suspend fun startIdSession(): VkIdSession {
        val uuid = UUID.randomUUID().toString()
        val cookies = mutableMapOf<String, String>()
        val url = buildString {
            append("https://id.vk.com/auth?app_id=$KATE_CLIENT_ID")
            append("&response_type=silent_token&v=1.46.0")
            append("&redirect_uri=${encode("https://oauth.vk.com/blank.html")}")
            append("&uuid=$uuid")
        }
        val html = follow("GET", url, cookies = cookies, ua = BROWSER_UA).second
        val anonymous = Regex("\"anonymous_token\"\\s*:\\s*\"([^\"]+)\"").find(html)?.groupValues?.get(1)
            ?: throw VkAuthException("Не удалось начать сессию VK ID")
        var authToken = Regex("\"auth_token\"\\s*:\\s*\"([^\"]+)\"").find(html)?.groupValues?.get(1)
            ?.takeIf { it.length >= 16 }
            .orEmpty()
        if (authToken.isBlank()) {
            runCatching {
                val json = postForm(
                    "https://login.vk.com/?act=connect_internal",
                    mapOf("app_id" to KATE_CLIENT_ID, "oauth_version" to "1", "version" to "1"),
                    cookies = cookies,
                    ua = BROWSER_UA,
                    origin = "https://id.vk.com",
                )
                val data = json["data"]?.jsonObject ?: json
                authToken = data.str("access_token") ?: data.str("auth_token").orEmpty()
            }
        }
        return VkIdSession(uuid, anonymous, authToken, cookies)
    }

    suspend fun validatePhone(
        session: VkIdSession,
        phone: String,
        deviceId: String,
        captchaSid: String? = null,
        captchaKey: String? = null,
    ): Pair<String, String> {
        val extra = mutableMapOf(
            "login" to phone,
            "client_id" to KATE_CLIENT_ID,
            "anonymous_token" to session.anonymousToken,
            "supported_ways" to "password,passkey,push,email,sms,callreset",
            "device_id" to deviceId,
            "uuid" to session.uuid,
            "flow_type" to "auth_without_password",
        )
        if (session.authToken.isNotBlank()) extra["auth_token"] = session.authToken
        if (!captchaSid.isNullOrBlank() && !captchaKey.isNullOrBlank()) {
            extra["captcha_sid"] = captchaSid
            extra["captcha_key"] = captchaKey
        }
        val obj = try {
            postForm(
                "https://api.vk.com/method/auth.validateAccount?v=$AUTH_API&client_id=$KATE_CLIENT_ID",
                extra,
                cookies = session.cookies,
                ua = BROWSER_UA,
                origin = "https://id.vk.com",
            )
        } catch (e: VkAuthException) {
            if (e.robot) throw e
            throw e
        }
        throwIfApiError(obj)
        val r = obj["response"]?.jsonObject ?: throw VkAuthException("VK не принял номер телефона")
        val sid = r.str("sid") ?: throw VkAuthException("VK не принял номер телефона")
        val next = r["next_step"]?.jsonObject
        val verification = (next?.str("verification_method") ?: next?.str("name")).orEmpty().lowercase()
        val profile = r["profile"]?.jsonObject
        val mask = profile?.str("phone") ?: phone
        val canSkip = r["can_skip_password"]?.jsonPrimitive?.booleanOrNull == true ||
            r["can_skip_password"]?.jsonPrimitive?.intOrNull == 1 ||
            otpAlreadySent(verification)
        if (!canSkip && !otpAlreadySent(verification)) {
            throw VkAuthException("Для этого аккаунта VK просит пароль", passwordRequired = true)
        }
        return sid to mask
    }

    suspend fun confirmSms(
        session: VkIdSession,
        phone: String,
        sid: String,
        code: String,
        deviceId: String,
    ): VkTokenPair {
        val body = mutableMapOf(
            "username" to phone,
            "anonymous_token" to session.anonymousToken,
            "sid" to sid,
            "uuid" to session.uuid,
            "v" to AUTH_API,
            "device_id" to deviceId,
            "version" to "1",
            "app_id" to KATE_CLIENT_ID,
            "code" to code,
        )
        if (session.authToken.isNotBlank()) body["auth_token"] = session.authToken
        val obj = postForm(
            "https://login.vk.com/?act=connect_authorize",
            body,
            cookies = session.cookies,
            ua = BROWSER_UA,
            origin = "https://id.vk.com",
        )
        if (obj.str("type") == "error" || obj["error"] != null) {
            val type = obj.str("error_type") ?: obj.str("error").orEmpty()
            val desc = obj.str("error_description") ?: obj.str("error_text").orEmpty()
            if (type.contains("otp", true) || desc.contains("код", true)) {
                throw VkAuthException("Неверный код из SMS")
            }
            if (type.contains("password", true)) {
                throw VkAuthException("Для этого аккаунта VK просит пароль", passwordRequired = true)
            }
            throw VkAuthException(desc.ifBlank { "VK отклонил вход по SMS" })
        }
        val data = obj["data"]?.jsonObject ?: obj
        val parsed = VkOAuthPayload(
            accessToken = data.str("access_token"),
            userId = data["user_id"]?.jsonPrimitive?.longOrNull ?: data.str("user_id")?.toLongOrNull(),
            silentToken = data.str("silent_token"),
            uuid = data.str("silent_token_uuid") ?: data.str("uuid"),
        )
        return materialize(parsed)
    }

    suspend fun materialize(raw: VkOAuthPayload): VkTokenPair {
        if (!raw.accessToken.isNullOrBlank()) {
            runCatching { return upgradeKate(raw.accessToken) }
            val userId = raw.userId ?: fetchUserId(raw.accessToken)
            return VkTokenPair(raw.accessToken, userId)
        }
        if (!raw.silentToken.isNullOrBlank()) {
            val uuid = raw.uuid ?: throw VkAuthException("VK не вернул uuid silent-токена")
            val exchanged = exchangeSilent(raw.silentToken, uuid)
            return runCatching { upgradeKate(exchanged.accessToken) }.getOrDefault(exchanged)
        }
        throw VkAuthException("VK не вернул токен сессии")
    }

    private suspend fun upgradeKate(androidToken: String): VkTokenPair {
        val qr = startQr()
        if (qr.authCode.isBlank()) throw VkAuthException("VK не выдал код для обмена токена")
        postForm(
            "https://api.vk.com/method/auth.processAuthCode",
            mapOf("access_token" to androidToken, "auth_code" to qr.authCode, "action" to "0", "v" to AUTH_API),
            ua = BROWSER_UA,
        )
        postForm(
            "https://api.vk.com/method/auth.processAuthCode",
            mapOf("access_token" to androidToken, "auth_code" to qr.authCode, "action" to "1", "v" to AUTH_API),
            ua = BROWSER_UA,
        )
        repeat(12) {
            val check = postForm(
                "https://api.vk.com/method/auth.checkAuthCode",
                mapOf(
                    "anonymous_token" to qr.anonym,
                    "auth_hash" to qr.hash,
                    "v" to AUTH_API,
                    "web_auth" to "0",
                ),
                kate = true,
            )
            val r = check["response"]?.jsonObject ?: return@repeat
            when (r["status"]?.jsonPrimitive?.intOrNull) {
                2 -> {
                    val access = r.str("access_token") ?: throw VkAuthException("VK не вернул токен после SMS")
                    val userId = r["user_id"]?.jsonPrimitive?.longOrNull ?: fetchUserId(access)
                    return VkTokenPair(access, userId)
                }
                3 -> throw VkAuthException("VK отклонил подтверждение входа")
                4 -> throw VkAuthException("Сессия входа истекла. Попробуйте ещё раз")
            }
            kotlinx.coroutines.delay(400)
        }
        throw VkAuthException("Не удалось получить токен Kate после входа по SMS")
    }

    private data class Qr(val anonym: String, val hash: String, val authCode: String)

    private suspend fun startQr(): Qr {
        val anonym = apiMethod(
            "auth.getAnonymToken",
            mapOf("client_id" to ANDROID_CLIENT_ID, "client_secret" to ANDROID_CLIENT_SECRET, "v" to AUTH_API),
        ).str("token") ?: throw VkAuthException("Не удалось получить анонимный токен VK")
        val r = apiMethod(
            "auth.getAuthCode",
            mapOf(
                "client_id" to KATE_CLIENT_ID,
                "scope" to KATE_SCOPE_ALL,
                "anonymous_token" to anonym,
                "device_name" to "MusicStreamService Android",
                "v" to AUTH_API,
            ),
        )
        val url = r.str("auth_url") ?: throw VkAuthException("VK не выдал QR-код")
        val hash = r.str("auth_hash") ?: throw VkAuthException("VK не выдал QR-код")
        val code = r.str("auth_code") ?: queryMap(java.net.URI(url).rawQuery)["q"].orEmpty()
        return Qr(anonym, hash, code)
    }

    private suspend fun exchangeSilent(silent: String, uuid: String): VkTokenPair {
        val anonym = runCatching {
            postForm(
                "https://login.vk.com/?act=get_anonym_token",
                mapOf(
                    "client_id" to KATE_CLIENT_ID,
                    "client_secret" to KATE_CLIENT_SECRET,
                    "version" to "1",
                    "app_id" to KATE_CLIENT_ID,
                ),
                kate = true,
            )["data"]?.jsonObject?.str("access_token")
        }.getOrNull() ?: apiMethod(
            "auth.getAnonymToken",
            mapOf("client_id" to ANDROID_CLIENT_ID, "client_secret" to ANDROID_CLIENT_SECRET, "v" to AUTH_API),
        ).str("token") ?: throw VkAuthException("Не удалось получить анонимный токен Kate")
        val r = apiMethod(
            "auth.exchangeSilentAuthToken",
            mapOf(
                "access_token" to anonym,
                "token" to silent,
                "uuid" to uuid,
                "client_id" to KATE_CLIENT_ID,
                "v" to AUTH_API,
            ),
        )
        val access = r.str("access_token") ?: throw VkAuthException("Не удалось обменять silent-токен VK")
        val userId = r["user_id"]?.jsonPrimitive?.longOrNull ?: fetchUserId(access)
        return VkTokenPair(access, userId)
    }

    private suspend fun fetchUserId(access: String): Long {
        val obj = postForm(
            "https://api.vk.com/method/users.get",
            mapOf("access_token" to access, "v" to API),
            kate = true,
        )
        val first = obj["response"]?.let { el ->
            if (el is kotlinx.serialization.json.JsonArray) el.firstOrNull()?.jsonObject else el.jsonObject
        }
        return first?.get("id")?.jsonPrimitive?.longOrNull
            ?: throw VkAuthException("Не удалось определить пользователя VK")
    }

    private suspend fun apiMethod(method: String, body: Map<String, String>): JsonObject {
        val obj = postForm("https://api.vk.com/method/$method", body, kate = true, origin = "https://id.vk.com")
        throwIfApiError(obj)
        return obj["response"]?.jsonObject ?: throw VkAuthException("Пустой ответ VK ($method)")
    }

    private suspend fun postForm(
        url: String,
        body: Map<String, String?>,
        cookies: MutableMap<String, String>? = null,
        kate: Boolean = false,
        ua: String = if (kate) KATE_UA else BROWSER_UA,
        origin: String? = null,
    ): JsonObject {
        val text = follow("POST", url, body, cookies, ua, origin).second
        val parsed = runCatching { json.parseToJsonElement(text).jsonObject }.getOrElse {
            throw VkAuthException("VK вернул не JSON")
        }
        throwIfApiError(parsed)
        return parsed
    }

    private fun throwIfApiError(obj: JsonObject) {
        val err = obj["error"] ?: return
        if (err is kotlinx.serialization.json.JsonPrimitive) {
            when (err.content) {
                "need_captcha" -> throw VkAuthException(
                    "Введите код с картинки",
                    captchaSid = obj.str("captcha_sid"),
                    captchaImg = obj.str("captcha_img"),
                )
                "need_validation" -> throw VkAuthException(
                    obj.str("error_description") ?: "Введите код подтверждения",
                    need2fa = true,
                    phoneMask = obj.str("phone_mask"),
                )
                else -> throw VkAuthException(obj.str("error_description") ?: err.content)
            }
        }
        val o = err.jsonObject
        val code = o["error_code"]?.jsonPrimitive?.intOrNull
        val msg = o.str("error_text") ?: o.str("error_msg") ?: "Ошибка VK"
        val captchaSid = o.str("captcha_sid")
        val captchaImg = o.str("captcha_img")
        val redirect = o.str("redirect_uri").orEmpty()
        if (code == 14 || !captchaSid.isNullOrBlank()) {
            if (redirect.contains("not_robot_captcha", true)) {
                throw VkAuthException("VK просит проверку «я не робот». Войдите через страницу VK ID", robot = true)
            }
            throw VkAuthException("Введите код с картинки", captchaSid = captchaSid, captchaImg = captchaImg)
        }
        if (code == 9 || msg.contains("flood", true)) {
            throw VkAuthException("Слишком много попыток, подождите пару минут", robot = true)
        }
        throw VkAuthException(msg)
    }

    private suspend fun follow(
        method: String,
        url: String,
        body: Map<String, String?>? = null,
        cookies: MutableMap<String, String>? = null,
        ua: String,
        origin: String? = null,
    ): Pair<Int, String> {
        var currentMethod = method
        var currentUrl = url
        var currentBody = body
        repeat(9) {
            val res = http.request {
                this.method = if (currentMethod == "POST") HttpMethod.Post else HttpMethod.Get
                url(currentUrl)
                header("User-Agent", ua)
                if (ua == KATE_UA) header("X-Requested-With", "com.perm.kate_new_6")
                origin?.let {
                    header("Origin", it)
                    header("Referer", "$it/")
                }
                cookies?.takeIf { it.isNotEmpty() }?.let { store ->
                    header("Cookie", store.entries.joinToString("; ") { "${it.key}=${it.value}" })
                }
                if (currentMethod == "POST") {
                    contentType(ContentType.Application.FormUrlEncoded)
                    setBody(
                        FormDataContent(
                            Parameters.build {
                                currentBody?.forEach { (k, v) -> if (!v.isNullOrBlank()) append(k, v) }
                            },
                        ),
                    )
                }
            }
            cookies?.let { absorbCookies(res.headers, it) }
            val code = res.status.value
            if (code in 300..399) {
                val loc = res.headers[HttpHeaders.Location] ?: return code to res.bodyAsText()
                val next = java.net.URI(currentUrl).resolve(loc).toString()
                parseOAuthRedirect(next)?.let { oauth ->
                    if (!oauth.accessToken.isNullOrBlank() || !oauth.silentToken.isNullOrBlank()) {
                        return 200 to """{"data":{"access_token":"${oauth.accessToken ?: ""}","user_id":${oauth.userId ?: 0},"silent_token":"${oauth.silentToken ?: ""}","uuid":"${oauth.uuid ?: ""}"}}"""
                    }
                }
                currentUrl = next
                if (code != 307 && code != 308) {
                    currentMethod = "GET"
                    currentBody = null
                }
            } else {
                return code to res.bodyAsText()
            }
        }
        throw VkAuthException("Слишком много редиректов VK")
    }

    private fun absorbCookies(headers: io.ktor.http.Headers, cookies: MutableMap<String, String>) {
        headers.getAll(HttpHeaders.SetCookie)?.forEach { raw ->
            val pair = raw.substringBefore(';')
            val name = pair.substringBefore('=').trim()
            val value = pair.substringAfter('=').trim()
            if (name.isNotBlank() && value.isNotBlank() && value != "DELETED") cookies[name] = value
        }
    }

    private fun passwordError(obj: JsonObject): String {
        val desc = obj.str("error_description") ?: obj.str("error").orEmpty()
        return when {
            desc.contains("password", true) || desc.contains("username", true) -> "Неверный логин или пароль"
            desc.isBlank() -> "Не удалось войти во VK"
            else -> desc
        }
    }

    private fun queryMap(raw: String?): Map<String, String> {
        if (raw.isNullOrBlank()) return emptyMap()
        return raw.split('&').mapNotNull { part ->
            val eq = part.indexOf('=')
            if (eq <= 0) return@mapNotNull null
            val key = java.net.URLDecoder.decode(part.substring(0, eq), Charsets.UTF_8)
            val value = java.net.URLDecoder.decode(part.substring(eq + 1), Charsets.UTF_8)
            key to value
        }.toMap()
    }

    private fun JsonObject.str(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull

    private fun encode(v: String) = java.net.URLEncoder.encode(v, Charsets.UTF_8)
}
