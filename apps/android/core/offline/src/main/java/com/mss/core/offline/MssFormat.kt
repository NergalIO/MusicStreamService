package com.mss.core.offline

import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import kotlin.math.ceil

object MssFormat {
    private val MAGIC = byteArrayOf('M'.code.toByte(), 'S'.code.toByte(), 'S'.code.toByte(), '1'.code.toByte())
    private const val VERSION = 1
    const val HEADER_SIZE = 56

    fun deriveContentKey(userId: String, deviceId: String, trackId: String, serverSecret: String): ByteArray {
        val salt = hmacSha256(serverSecret.toByteArray(), "mss-offline-v1".toByteArray())
        val ikm = "$userId:$deviceId:$trackId".toByteArray()
        return hkdfSha256(ikm, salt, "mss-content-key".toByteArray(), 32)
    }

    fun computeDeviceBindingHash(deviceId: String, serverSecret: String): ByteArray =
        hmacSha256(serverSecret.toByteArray(), deviceId.toByteArray()).copyOf(16)

    fun encode(
        trackId: String,
        deviceId: String,
        payload: ByteArray,
        contentKey: ByteArray,
        serverSecret: String,
    ): ByteArray {
        val nonce = ByteArray(12).also { java.security.SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(contentKey, "AES"), GCMParameterSpec(128, nonce))
        val ciphertext = cipher.doFinal(payload)
        val header = ByteBuffer.allocate(HEADER_SIZE).order(ByteOrder.LITTLE_ENDIAN)
        header.put(MAGIC)
        header.putShort(VERSION.toShort())
        header.putShort(3) // FLAG_CODEC_OPUS | FLAG_ENCRYPTED
        header.put(parseUuid(trackId))
        header.put(computeDeviceBindingHash(deviceId, serverSecret))
        header.put(nonce)
        header.putInt(ciphertext.size)
        return header.array() + ciphertext
    }

    fun decode(
        data: ByteArray,
        deviceId: String,
        contentKey: ByteArray,
        serverSecret: String,
    ): Pair<String, ByteArray> {
        if (data.size < HEADER_SIZE) throw IllegalArgumentException("Invalid MSS file")
        if (!data.copyOfRange(0, 4).contentEquals(MAGIC)) throw IllegalArgumentException("Invalid MSS magic")
        val buf = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN)
        buf.position(4)
        val version = buf.short.toInt() and 0xFFFF
        if (version != VERSION) throw IllegalArgumentException("Unsupported MSS version $version")
        buf.position(8)
        val trackId = formatUuid(data.copyOfRange(8, 24))
        val binding = data.copyOfRange(24, 40)
        val expected = computeDeviceBindingHash(deviceId, serverSecret)
        if (!binding.contentEquals(expected)) throw IllegalArgumentException("Device binding mismatch")
        val nonce = data.copyOfRange(40, 52)
        val ctLen = ByteBuffer.wrap(data, 52, 4).order(ByteOrder.LITTLE_ENDIAN).int
        val ciphertext = data.copyOfRange(56, 56 + ctLen)
        if (ciphertext.size < 16) throw IllegalArgumentException("Invalid ciphertext")
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(contentKey, "AES"), GCMParameterSpec(128, nonce))
        return trackId to cipher.doFinal(ciphertext)
    }

    private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        return mac.doFinal(data)
    }

    internal fun hkdfSha256(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(if (salt.isEmpty()) ByteArray(32) else salt, "HmacSHA256"))
        val prk = mac.doFinal(ikm)
        val n = ceil(length / 32.0).toInt()
        var t = ByteArray(0)
        val okm = ByteArrayOutputStream()
        for (i in 1..n) {
            mac.init(SecretKeySpec(prk, "HmacSHA256"))
            mac.update(t)
            mac.update(info)
            mac.update(i.toByte())
            t = mac.doFinal()
            okm.write(t)
        }
        return okm.toByteArray().copyOf(length)
    }

    private fun parseUuid(uuid: String): ByteArray {
        val hex = uuid.replace("-", "")
        return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    private fun formatUuid(buf: ByteArray): String {
        val h = buf.joinToString("") { "%02x".format(it) }
        return "${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}"
    }

    fun sha256Hex(bytes: ByteArray): String {
        val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
        return digest.joinToString("") { "%02x".format(it) }
    }
}
