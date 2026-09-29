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

const val COVER_ACCENT = "cover"

data class AccentPreset(val id: String, val label: String, val h: Float, val s: Float, val l: Float)

/** Те же пресеты, что на десктопе: h в градусах, s и l — 0..1. */
val ACCENTS = listOf(
    AccentPreset("violet", "Фиолетовый", 262f, 0.83f, 0.66f),
    AccentPreset("blue", "Синий", 217f, 0.91f, 0.60f),
    AccentPreset("teal", "Бирюзовый", 178f, 0.70f, 0.42f),
    AccentPreset("green", "Зелёный", 145f, 0.63f, 0.45f),
    AccentPreset("amber", "Янтарный", 36f, 0.95f, 0.52f),
    AccentPreset("orange", "Оранжевый", 20f, 0.92f, 0.56f),
    AccentPreset("rose", "Розовый", 340f, 0.82f, 0.60f),
    AccentPreset("red", "Красный", 0f, 0.80f, 0.58f),
)

/** Цвет обложки: насыщенность поднята, яркость в читаемом диапазоне. null — слишком серый. */
fun coverAccentHsl(r: Int, g: Int, b: Int): Triple<Float, Float, Float>? {
    val (h, s) = rgbToHsl(r, g, b)
    if (s < 0.12f) return null
    return Triple(h, (s * 1.3f).coerceIn(0.55f, 0.90f), 0.62f)
}

private fun rgbToHsl(r: Int, g: Int, b: Int): Pair<Float, Float> {
    val rf = r / 255f
    val gf = g / 255f
    val bf = b / 255f
    val maxC = maxOf(rf, gf, bf)
    val minC = minOf(rf, gf, bf)
    if (maxC == minC) return 0f to 0f
    val d = maxC - minC
    val l = (maxC + minC) / 2f
    val s = if (l > 0.5f) d / (2f - maxC - minC) else d / (maxC + minC)
    val h = when (maxC) {
        rf -> (gf - bf) / d + if (gf < bf) 6f else 0f
        gf -> (bf - rf) / d + 2f
        else -> (rf - gf) / d + 4f
    }
    return h * 60f to s
}

/** Те же роли, что у desktop: background, card, elevated, sidebar, foreground, muted, border, primary, danger. */
fun mssAccent(accent: String, dark: Boolean, cover: Triple<Float, Float, Float>? = null): Color {
    val preset = ACCENTS.find { it.id == accent } ?: ACCENTS.first()
    val (h, s, l) = if (accent == COVER_ACCENT) cover ?: Triple(preset.h, preset.s, preset.l) else Triple(preset.h, preset.s, preset.l)
    val lightness = if (dark) l else max(0.38f, l - 0.12f)
    return Color.hsl(h, s, lightness)
}

fun mssColorScheme(accent: String, dark: Boolean, cover: Triple<Float, Float, Float>? = null) = if (dark) {
    darkColorScheme(
        primary = mssAccent(accent, true, cover),
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
        primary = mssAccent(accent, false, cover),
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
    cover: Triple<Float, Float, Float>? = null,
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = mssColorScheme(accent, dark, cover),
        typography = MssTypography,
        shapes = MssShapes,
        content = content,
    )
}
