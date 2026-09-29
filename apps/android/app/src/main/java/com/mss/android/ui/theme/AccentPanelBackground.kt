package com.mss.android.ui.theme

import android.graphics.RenderEffect
import android.graphics.Shader
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asComposeRenderEffect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import coil.compose.AsyncImage

/** Фон нижней панели (мини-плеер): градиент акцента или обложки при «Динамическая». */
@Composable
fun AccentPanelBackground(
    accent: String,
    coverUrl: String?,
    modifier: Modifier = Modifier,
    content: @Composable BoxScope.() -> Unit,
) {
    val dark = isSystemInDarkTheme()
    val scheme = MaterialTheme.colorScheme
    val coverHsl = if (accent == COVER_ACCENT) rememberCoverHsl(coverUrl) else null
    val accentColor = mssAccent(accent, dark, coverHsl)
    val base = scheme.surfaceContainer

    BoxWithConstraints(modifier.background(base)) {
        val widthPx = constraints.maxWidth.toFloat().coerceAtLeast(1f)
        if (accent == COVER_ACCENT && !coverUrl.isNullOrBlank()) {
            AsyncImage(
                model = coverUrl,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer {
                        scaleX = 1.35f
                        scaleY = 1.35f
                        alpha = 0.5f
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            renderEffect = coverBlurEffect()
                        }
                    },
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.linearGradient(
                            colors = listOf(
                                accentColor.copy(alpha = 0.55f),
                                accentColor.copy(alpha = 0.28f),
                                base.copy(alpha = 0.92f),
                            ),
                            start = Offset.Zero,
                            end = Offset(widthPx, widthPx * 0.35f),
                        ),
                    ),
            )
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                Color.Black.copy(alpha = 0.08f),
                                base.copy(alpha = 0.75f),
                                base.copy(alpha = 0.96f),
                            ),
                        ),
                    ),
            )
        } else {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(
                        Brush.linearGradient(
                            colors = listOf(
                                accentColor.copy(alpha = if (dark) 0.42f else 0.30f),
                                accentColor.copy(alpha = if (dark) 0.20f else 0.14f),
                                base,
                            ),
                            start = Offset.Zero,
                            end = Offset(widthPx, 0f),
                        ),
                    ),
            )
        }
        content()
    }
}

@RequiresApi(Build.VERSION_CODES.S)
private fun coverBlurEffect() = RenderEffect.createBlurEffect(48f, 48f, Shader.TileMode.CLAMP).asComposeRenderEffect()
