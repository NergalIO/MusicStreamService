package com.mss.android.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

private val coverBrush = Brush.sweepGradient(
    listOf(
        Color(0xFFF43F5E),
        Color(0xFFF59E0B),
        Color(0xFF22C55E),
        Color(0xFF3B82F6),
        Color(0xFFA855F7),
        Color(0xFFF43F5E),
    ),
)

@Composable
fun AccentSwatches(selected: String, onSelect: (String) -> Unit, modifier: Modifier = Modifier) {
    ChipFlow(modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
        ACCENTS.forEach { preset ->
            Swatch(
                selected = selected == preset.id,
                label = preset.label,
                color = Color.hsl(preset.h, preset.s, preset.l),
                onClick = { onSelect(preset.id) },
            )
        }
        Swatch(
            selected = selected == COVER_ACCENT,
            label = "Из обложки текущего трека",
            brush = coverBrush,
            icon = true,
            onClick = { onSelect(COVER_ACCENT) },
        )
    }
}

@Composable
private fun Swatch(
    selected: Boolean,
    label: String,
    onClick: () -> Unit,
    color: Color = Color.Unspecified,
    brush: Brush? = null,
    icon: Boolean = false,
) {
    Box(
        Modifier
            .size(36.dp)
            .semantics {
                role = Role.RadioButton
                this.selected = selected
                contentDescription = label
            }
            .clip(CircleShape)
            .then(if (brush != null) Modifier.background(brush) else Modifier.background(color))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        if (selected) {
            Icon(Icons.Default.Check, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
        } else if (icon) {
            Icon(Icons.Default.Image, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
        }
    }
}
