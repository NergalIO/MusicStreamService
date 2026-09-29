package com.mss.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.max

/** Те же роли, что у desktop: background, card, elevated, sidebar, foreground, muted, border, primary, danger. */
fun mssAccent(accent: String, dark: Boolean): Color {
    val (h, s, l) = when (accent) {
        "teal" -> Triple(178f, 0.70f, 0.42f)
        "amber" -> Triple(36f, 0.95f, 0.52f)
        "blue" -> Triple(217f, 0.91f, 0.60f)
        else -> Triple(262f, 0.83f, 0.66f)
    }
    val lightness = if (dark) l else max(0.38f, l - 0.12f)
    return Color.hsl(h, s, lightness)
}

fun mssColorScheme(accent: String, dark: Boolean) = if (dark) {
    darkColorScheme(
        primary = mssAccent(accent, true),
        onPrimary = Color.White,
        background = Color.hsl(240f, 0.06f, 0.07f),
        onBackground = Color.hsl(0f, 0f, 0.97f),
        surface = Color.hsl(240f, 0.05f, 0.11f),
        onSurface = Color.hsl(0f, 0f, 0.97f),
        surfaceVariant = Color.hsl(240f, 0.05f, 0.15f),
        onSurfaceVariant = Color.hsl(240f, 0.04f, 0.60f),
        surfaceContainer = Color.hsl(240f, 0.05f, 0.09f),
        surfaceContainerHigh = Color.hsl(240f, 0.05f, 0.15f),
        outline = Color.hsl(240f, 0.05f, 0.17f),
        outlineVariant = Color.hsl(240f, 0.05f, 0.17f),
        error = Color.hsl(354f, 0.85f, 0.60f),
        onError = Color.White,
    )
} else {
    lightColorScheme(
        primary = mssAccent(accent, false),
        onPrimary = Color.White,
        background = Color.hsl(240f, 0.10f, 0.97f),
        onBackground = Color.hsl(240f, 0.10f, 0.09f),
        surface = Color.White,
        onSurface = Color.hsl(240f, 0.10f, 0.09f),
        surfaceVariant = Color.hsl(240f, 0.10f, 0.95f),
        onSurfaceVariant = Color.hsl(240f, 0.04f, 0.40f),
        surfaceContainer = Color.hsl(240f, 0.08f, 0.94f),
        surfaceContainerHigh = Color.White,
        outline = Color.hsl(240f, 0.06f, 0.87f),
        outlineVariant = Color.hsl(240f, 0.06f, 0.87f),
        error = Color.hsl(354f, 0.72f, 0.48f),
        onError = Color.White,
    )
}

private val MssFont = FontFamily.SansSerif

val MssTypography = Typography(
    headlineSmall = TextStyle(fontFamily = MssFont, fontWeight = FontWeight.Bold, fontSize = 24.sp, lineHeight = 30.sp, letterSpacing = (-0.4).sp),
    titleLarge = TextStyle(fontFamily = MssFont, fontWeight = FontWeight.Bold, fontSize = 20.sp, lineHeight = 26.sp, letterSpacing = (-0.3).sp),
    titleMedium = TextStyle(fontFamily = MssFont, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp, letterSpacing = (-0.15).sp),
    bodyLarge = TextStyle(fontFamily = MssFont, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 20.sp),
    bodyMedium = TextStyle(fontFamily = MssFont, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = MssFont, fontWeight = FontWeight.Normal, fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontFamily = MssFont, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 18.sp),
    labelMedium = TextStyle(fontFamily = MssFont, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp),
    labelSmall = TextStyle(fontFamily = MssFont, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.6.sp),
)

val MssShapes = Shapes(
    extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(6.dp),
    small = androidx.compose.foundation.shape.RoundedCornerShape(8.dp),
    medium = androidx.compose.foundation.shape.RoundedCornerShape(10.dp),
    large = androidx.compose.foundation.shape.RoundedCornerShape(16.dp),
    extraLarge = androidx.compose.foundation.shape.RoundedCornerShape(20.dp),
)

@Composable
fun MssTheme(
    accent: String = "violet",
    dark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = mssColorScheme(accent, dark),
        typography = MssTypography,
        shapes = MssShapes,
        content = content,
    )
}
