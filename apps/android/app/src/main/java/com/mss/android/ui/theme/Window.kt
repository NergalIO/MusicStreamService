package com.mss.android.ui.theme

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.min

data class MssWindow(
    val widthDp: Int,
    val heightDp: Int,
    val compact: Boolean,
    val short: Boolean,
    val landscape: Boolean,
) {
    fun shelf(): Dp = if (compact) 112.dp else 140.dp

    fun cover(max: Dp = 280.dp): Dp {
        val byWidth = (widthDp - 48).coerceAtLeast(120)
        val byHeight = if (short || landscape) (heightDp * 0.34).toInt() else (heightDp * 0.42).toInt()
        return min(max.value.toInt(), min(byWidth, byHeight.coerceAtLeast(120))).dp
    }
}

@Composable
fun rememberMssWindow(): MssWindow {
    val c = LocalConfiguration.current
    return remember(c.screenWidthDp, c.screenHeightDp) {
        MssWindow(
            widthDp = c.screenWidthDp,
            heightDp = c.screenHeightDp,
            compact = c.screenWidthDp < 400,
            short = c.screenHeightDp < 640,
            landscape = c.screenWidthDp > c.screenHeightDp,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ChipFlow(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    FlowRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        content()
    }
}
