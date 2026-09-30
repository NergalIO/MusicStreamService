package com.mss.android.ui.components

import coil.disk.DiskCache
import coil.intercept.Interceptor
import coil.network.HttpException
import coil.request.ErrorResult
import coil.request.ImageResult
import coil.request.SuccessResult
import com.mss.core.connectors.SpotifyWebSession
import java.io.IOException
import java.nio.ByteBuffer
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withTimeoutOrNull

/** Обложки Spotify не доходят ни напрямую, ни через веб-плеер — обычно сеть блокирует CDN Spotify. */
object SpotifyCoverHealth {
    private val _unreachable = MutableStateFlow(false)
    val unreachable: StateFlow<Boolean> = _unreachable
    @Volatile private var dismissed = false

    internal fun report(ok: Boolean) {
        if (ok) _unreachable.value = false else if (!dismissed) _unreachable.value = true
    }

    fun dismiss() {
        dismissed = true
        _unreachable.value = false
    }
}

/**
 * Обложки Spotify: если прямой запрос к CDN не прошёл (в некоторых сетях он висит или сбрасывается),
 * картинка скачивается через страницу веб-плеера, у которой сеть до Spotify работает.
 */
class SpotifyCoverInterceptor(
    private val web: SpotifyWebSession,
    private val diskCache: DiskCache,
) : Interceptor {
    @Volatile private var directFailures = 0

    override suspend fun intercept(chain: Interceptor.Chain): ImageResult {
        val request = chain.request
        val url = request.data as? String
        if (url == null || !isSpotifyImage(url)) return chain.proceed(request)
        if (cached(url)) return chain.proceed(request)
        val direct = if (directFailures < DIRECT_FAILURE_LIMIT) {
            withTimeoutOrNull(DIRECT_TIMEOUT_MS) { chain.proceed(request) }
        } else {
            null
        }
        if (direct is SuccessResult) {
            directFailures = 0
            SpotifyCoverHealth.report(ok = true)
            return direct
        }
        val networkFailure = direct == null || (direct as ErrorResult).throwable !is HttpException
        if (networkFailure) directFailures += 1
        val bytes = web.fetchImage(url)
        if (bytes == null) {
            if (networkFailure) SpotifyCoverHealth.report(ok = false)
            return direct ?: ErrorResult(null, request, IOException("Обложка Spotify недоступна"))
        }
        SpotifyCoverHealth.report(ok = true)
        store(url, bytes)
        return chain.proceed(
            request.newBuilder()
                .data(ByteBuffer.wrap(bytes))
                .memoryCacheKey(url)
                .build(),
        )
    }

    private fun cached(url: String): Boolean =
        runCatching { diskCache.openSnapshot(url)?.use { true } ?: false }.getOrDefault(false)

    /** Запись без метаданных ответа Coil отдаёт с диска как есть — следующий показ обойдётся без веб-плеера. */
    private fun store(url: String, bytes: ByteArray) {
        runCatching {
            val editor = diskCache.openEditor(url) ?: return
            try {
                diskCache.fileSystem.write(editor.data) { write(bytes) }
                editor.commit()
            } catch (e: Exception) {
                editor.abort()
            }
        }
    }

    private fun isSpotifyImage(url: String): Boolean =
        url.contains("scdn.co") || url.contains("spotifycdn.com")

    private companion object {
        const val DIRECT_TIMEOUT_MS = 6_000L
        const val DIRECT_FAILURE_LIMIT = 2
    }
}
