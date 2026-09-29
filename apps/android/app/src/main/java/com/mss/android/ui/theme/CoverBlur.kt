package com.mss.android.ui.theme

import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.graphicsLayer

/**
 * Размытие только этой картинки.
 * Без своего слоя RenderEffect на Android 12+ применяется ко всему экрану, и поверх фона пропадает интерфейс.
 */
fun Modifier.isolatedCoverBlur(
    radiusPx: Float,
    scale: Float = 1f,
    alpha: Float = 1f,
    enabled: Boolean = true,
): Modifier = this
    .clipToBounds()
    .graphicsLayer {
        scaleX = scale
        scaleY = scale
        this.alpha = alpha
        clip = true
        compositingStrategy = CompositingStrategy.Offscreen
        renderEffect = if (enabled && radiusPx > 0f && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            RenderEffect.createBlurEffect(radiusPx, radiusPx, Shader.TileMode.CLAMP).asComposeRenderEffect()
        } else {
            null
        }
    }
