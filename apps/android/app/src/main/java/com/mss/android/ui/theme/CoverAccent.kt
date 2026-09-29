package com.mss.android.ui.theme

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import coil.imageLoader
import coil.request.ImageRequest
import coil.request.SuccessResult
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private val coverCache = HashMap<String, Triple<Float, Float, Float>?>()

/** HSL обложки текущего трека. Пока кадра нет или он серый — null, тема остаётся фиолетовой. */
@Composable
fun rememberCoverHsl(url: String?): Triple<Float, Float, Float>? {
    var hsl by remember(url) { mutableStateOf(if (url != null && url in coverCache) coverCache[url] else null) }
    val context = LocalContext.current
    LaunchedEffect(url) {
        if (url.isNullOrBlank()) {
            hsl = null
            return@LaunchedEffect
        }
        if (url in coverCache) {
            hsl = coverCache[url]
            return@LaunchedEffect
        }
        val extracted = withContext(Dispatchers.IO) { dominantCoverHsl(context, url) }
        coverCache[url] = extracted
        hsl = extracted
    }
    return hsl
}

private suspend fun dominantCoverHsl(context: android.content.Context, url: String): Triple<Float, Float, Float>? {
    val result = context.imageLoader.execute(
        ImageRequest.Builder(context)
            .data(url)
            .size(24)
            .allowHardware(false)
            .build(),
    )
    val success = result as? SuccessResult ?: return null
    val bitmap = success.drawable.toBitmap() ?: return null
    val sample = if (bitmap.width == 24 && bitmap.height == 24) bitmap else Bitmap.createScaledBitmap(bitmap, 24, 24, true)
    var r = 0.0
    var g = 0.0
    var b = 0.0
    var total = 0.0
    for (y in 0 until sample.height) {
        for (x in 0 until sample.width) {
            val pixel = sample.getPixel(x, y)
            val pr = (pixel shr 16) and 0xFF
            val pg = (pixel shr 8) and 0xFF
            val pb = pixel and 0xFF
            val maxC = maxOf(pr, pg, pb)
            val minC = minOf(pr, pg, pb)
            val weight = 0.15 + (maxC - minC) / 255.0 + if (maxC > 40 && maxC < 235) 0.3 else 0.0
            r += pr * weight
            g += pg * weight
            b += pb * weight
            total += weight
        }
    }
    if (sample !== bitmap) sample.recycle()
    if (total <= 0.0) return null
    return coverAccentHsl((r / total).toInt(), (g / total).toInt(), (b / total).toInt())
}

private fun android.graphics.drawable.Drawable.toBitmap(): Bitmap? {
    if (this is BitmapDrawable && bitmap != null) return bitmap
    val width = intrinsicWidth.coerceAtLeast(1)
    val height = intrinsicHeight.coerceAtLeast(1)
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    setBounds(0, 0, width, height)
    draw(canvas)
    return bitmap
}
