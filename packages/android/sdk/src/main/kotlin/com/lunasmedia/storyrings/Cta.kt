package com.lunasmedia.storyrings

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.lunasmedia.storyrings.core.CtaStyle

private val textShadow = Shadow(Color(0x80000000), Offset(0f, 2f), 6f)

/**
 * The story button, in its style (spec: Story button): a white or dark pill, an outline, or a
 * swipe up (a chevron over the label, or over a white pill).
 */
@Composable
internal fun CtaButton(label: String, style: CtaStyle, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val pill = RoundedCornerShape(50)
    val base = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
    Column(
        modifier.clickable(role = Role.Button, onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (style.isSwipe) Chevron()
        val (text, box) = when (style) {
            CtaStyle.PILL, CtaStyle.SWIPE_PILL ->
                base.copy(color = Color.Black) to Modifier.clip(pill).background(Color.White).padding(horizontal = 22.dp, vertical = 12.dp)
            CtaStyle.DARK ->
                base.copy(color = Color.White) to Modifier.clip(pill).background(Color(0xFF111111)).padding(horizontal = 22.dp, vertical = 12.dp)
            CtaStyle.OUTLINE ->
                base.copy(color = Color.White, shadow = textShadow) to
                    Modifier.border(2.dp, Color.White, pill).padding(horizontal = 22.dp, vertical = 12.dp)
            CtaStyle.SWIPE ->
                base.copy(color = Color.White, shadow = textShadow) to Modifier.padding(start = 22.dp, end = 22.dp, top = 4.dp, bottom = 10.dp)
        }
        BasicText(label, box, style = text, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** An upward chevron that bobs gently, unless animations are turned off. */
@Composable
private fun Chevron() {
    val context = LocalContext.current
    val still = remember { context.animationsOff() }
    val lift by rememberInfiniteTransition(label = "chevron").animateFloat(
        initialValue = 0f,
        targetValue = if (still) 0f else -6f,
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
        label = "lift",
    )
    Canvas(
        Modifier
            .padding(top = 8.dp, bottom = 4.dp)
            .size(20.dp, 12.dp)
            .graphicsLayer { translationY = lift * density },
    ) {
        val w = 3.dp.toPx()
        val path = Path().apply {
            moveTo(w, size.height - w)
            lineTo(size.width / 2, w)
            lineTo(size.width - w, size.height - w)
        }
        drawPath(path, Color(0x60000000), style = Stroke(w + 2f, cap = StrokeCap.Round, join = StrokeJoin.Round))
        drawPath(path, Color.White, style = Stroke(w, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}
