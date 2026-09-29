package com.mss.core.connectors

import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

object YandexCrypto {
    const val ANDROID_SIGN_KEY = "p93jhgh689SBReK6ghtw62"
    const val DIRECT_LINK_SALT = "XGRlBW9FXlekgbPrRHuSiA"

    fun signTrack(trackId: String, ts: Long): String =
        hmacBase64(ANDROID_SIGN_KEY, "${trackBaseId(trackId)}$ts")

    fun signDirectLink(pathAfterGet: String, s: String, linkTs: String): String =
        hmacHex(DIRECT_LINK_SALT, DIRECT_LINK_SALT + pathAfterGet + s + linkTs)

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
