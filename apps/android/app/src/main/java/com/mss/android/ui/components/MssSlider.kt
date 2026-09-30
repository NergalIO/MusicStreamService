package com.mss.android.ui.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Слайдер с тонкой дорожкой и круглой точкой вместо стандартной вертикальной ручки Material3. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MssSlider(
    value: Float,
    onValueChange: (Float) -> Unit,
    modifier: Modifier = Modifier,
    valueRange: ClosedFloatingPointRange<Float> = 0f..1f,
    steps: Int = 0,
    onValueChangeFinished: (() -> Unit)? = null,
) {
    val scheme = MaterialTheme.colorScheme
    val colors = SliderDefaults.colors(
        thumbColor = scheme.onSurface,
        activeTrackColor = scheme.onSurface,
        inactiveTrackColor = scheme.onSurface.copy(alpha = 0.18f),
        activeTickColor = Color.Transparent,
        inactiveTickColor = Color.Transparent,
    )
    val interaction = remember { MutableInteractionSource() }
    val dragged by interaction.collectIsDraggedAsState()
    val pressed by interaction.collectIsPressedAsState()
    val thumbSize by animateDpAsState(if (dragged || pressed) 18.dp else 12.dp, label = "thumb")
    Slider(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        valueRange = valueRange,
        steps = steps,
        onValueChangeFinished = onValueChangeFinished,
        colors = colors,
        interactionSource = interaction,
        thumb = {
            Box(Modifier.size(18.dp), contentAlignment = Alignment.Center) {
                Box(
                    Modifier
                        .size(thumbSize)
                        .clip(CircleShape)
                        .background(scheme.onSurface),
                )
            }
        },
        track = { state ->
            SliderDefaults.Track(
                sliderState = state,
                modifier = Modifier.height(4.dp),
                colors = colors,
                drawStopIndicator = null,
                thumbTrackGapSize = 0.dp,
            )
        },
    )
}
