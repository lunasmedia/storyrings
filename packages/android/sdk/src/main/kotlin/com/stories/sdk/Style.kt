package com.stories.sdk

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** "#rrggbb" (or "#rgb") to a colour; [fallback] for anything else. */
internal fun parseHex(hex: String?, fallback: Color): Color {
    if (hex == null || !hex.startsWith("#")) return fallback
    var h = hex.substring(1)
    if (h.length == 3) h = h.map { "$it$it" }.joinToString("")
    if (h.length != 6) return fallback
    val v = h.toLongOrNull(16) ?: return fallback
    return Color(0xFF000000 or v)
}

/** Ring animation length per speed, the same as the other SDKs. */
internal val ringSpeedMs = mapOf("slow" to 4000, "normal" to 2400, "fast" to 1200)

/** Size and spacing your code can set; the dashboard's shape and size win once set there. */
data class StoriesTheme(
    /** Item width and height when the dashboard sets no shape and size. */
    val circleSize: Dp = 68.dp,
    val gap: Dp = 14.dp,
    /** Space before the first and after the last item. */
    val barPadding: Dp = 12.dp,
    val titleSize: TextUnit = 12.sp,
    /** Font family and so on for titles (the dashboard's title colour and weight win). */
    val titleStyle: TextStyle = TextStyle.Default,
    val hideTitles: Boolean = false,
)
