package com.mss.core.connectors

import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object YandexCrypto {
    const val ANDROID_SIGN_KEY = "p93jhgh689SBReK6ghtw62"
    const val WEB_FILE_INFO_SIGN_KEY = "7tvSmFbyf5hJnIHhCimDDD"
    const val DIRECT_LINK_SALT = "XGRlBW9FXlekgbPrRHuSiA"

    fun signTrack(trackId: String, ts: Long): String =
        hmacBase64(ANDROID_SIGN_KEY, "${trackBaseId(trackId)}$ts")

    /** Подпись get-file-info: HMAC веб-клиента без padding. */
    fun signFileInfo(ts: Long, trackId: String, quality: String, codecs: String, transport: String): String =
        hmacBase64(WEB_FILE_INFO_SIGN_KEY, "$ts$trackId$quality$codecs$transport").trimEnd('=')

    /** Прямая ссылка storage: MD5(salt + path без первого «/» + s). */
    fun directUrl(host: String, codec: String, path: String, s: String, ts: String): String {
        val hash = md5Hex(DIRECT_LINK_SALT + path.removePrefix("/") + s)
        return "https://$host/get-$codec/$hash/$ts$path"
    }

    fun md5Hex(data: String): String {
        val digest = MessageDigest.getInstance("MD5").digest(data.toByteArray())
        return digest.joinToString("") { "%02x".format(it) }
    }

    fun hmacBase64(key: String, data: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA256"))
        return Base64.getEncoder().encodeToString(mac.doFinal(data.toByteArray()))
    }

    fun hmacHex(key: String, data: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(), "HmacSHA256"))
        return mac.doFinal(data.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
