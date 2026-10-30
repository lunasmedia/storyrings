package com.stories.sdk

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.progressBarRangeInfo
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.setProgress
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import com.stories.core.FeedStory
import com.stories.core.Interaction
import com.stories.core.InteractionLabels
import com.stories.core.Interactions
import com.stories.core.StoredAnswer
import com.stories.core.countdownParts
import com.stories.core.percentages
import com.stories.core.placeInteraction
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

private val INK = Color(0xFF111111)
private val OPTION = Color(0xFFF1F3F5)
private val RAIL = Color(0xFFE9ECEF)
private val UNIT = Color(0xFF868E96)

/**
 * Interactive stickers (polls, quizzes, emoji sliders, links, countdowns) drawn over a story's
 * image, at the place the studio put them (spec/README.md, "Interactions"), placed with the
 * story's fit (covering the area, or shown whole in it). Only the stickers take touches; elsewhere they reach the
 * story's gestures underneath.
 */
@Composable
internal fun Stickers(controller: ViewerController, story: FeedStory) {
    // Redraws when answers or results arrive.
    controller.answersVersion
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val w = maxWidth.value.toDouble()
        val h = maxHeight.value.toDouble()
        for (i in story.interactions) {
            val p = placeInteraction(w, h, story.width?.toDouble(), story.height?.toDouble(), story.look.fills, i.x, i.y, i.width)
            val u = (p.width / Interactions.UNITS_PER_WIDTH).toFloat().dp
            val saved = controller.answers?.get(story.id, i.id)
            Box(
                Modifier
                    // Centred on (x, y), whatever its height.
                    .layout { measurable, constraints ->
                        val placeable = measurable.measure(constraints.copy(minWidth = 0, minHeight = 0))
                        layout(constraints.maxWidth, constraints.maxHeight) {
                            placeable.place(
                                (p.x.dp.roundToPx() - placeable.width / 2),
                                (p.y.dp.roundToPx() - placeable.height / 2),
                            )
                        }
                    }
                    .width(p.width.dp),
            ) {
                Sticker(controller, i, u, saved)
            }
        }
    }
}

@Composable
private fun Dp.sp(): TextUnit = with(LocalDensity.current) { this@sp.toSp() }

@Composable
private fun Sticker(controller: ViewerController, i: Interaction, u: Dp, saved: StoredAnswer?) {
    val accent = parseHex(i.accent, Color(0xFFC2255C))
    when (val k = i.kind) {
        is Interaction.Kind.Link -> Box(
            Modifier
                .fillMaxWidth()
                .height(u * 84)
                .shadow(u * 8, RoundedCornerShape(50))
                .clip(RoundedCornerShape(50))
                .background(Color.White)
                .clickable(role = Role.Button) { controller.openLink(k.label, k.url) }
                .padding(horizontal = u * 24),
            contentAlignment = Alignment.Center,
        ) {
            BasicText(
                "${k.label} ↗",
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                style = TextStyle(color = accent, fontSize = (u * 30).sp(), fontWeight = FontWeight.Bold),
            )
        }
        is Interaction.Kind.Poll -> Card(k.question, u) { Options(controller, i, k.options, null, saved, accent, u) }
        is Interaction.Kind.Quiz -> Card(k.question, u) { Options(controller, i, k.options, k.correct, saved, accent, u) }
        is Interaction.Kind.Slider -> Card(k.question, u) { SliderTrack(controller, i, k, saved, accent, u) }
        is Interaction.Kind.Countdown -> Card(k.title, u, titleColor = accent, titleSize = 28, titleWeight = FontWeight.SemiBold) {
            CountdownRow(k.endsAtMs, u)
        }
    }
}

@Composable
private fun Card(
    title: String,
    u: Dp,
    titleColor: Color = INK,
    titleSize: Int = 32,
    titleWeight: FontWeight = FontWeight.Bold,
    content: @Composable () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .shadow(u * 12, RoundedCornerShape(u * 28))
            .clip(RoundedCornerShape(u * 28))
            .background(Color.White)
            // Touches that miss the controls stop here, so they never skip the story.
            .pointerInput(Unit) { detectTapGestures { } }
            .padding(u * 28),
    ) {
        if (title.isNotEmpty()) {
            BasicText(
                title,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
                style = TextStyle(color = titleColor, fontSize = (u * titleSize).sp(), fontWeight = titleWeight, textAlign = TextAlign.Center),
                modifier = Modifier.fillMaxWidth().padding(bottom = u * 20),
            )
        }
        content()
    }
}

@Composable
private fun Options(
    controller: ViewerController,
    i: Interaction,
    options: List<String>,
    correct: Int?,
    saved: StoredAnswer?,
    accent: Color,
    u: Dp,
) {
    val pct = saved?.results?.counts?.let(::percentages)
    Column(verticalArrangement = Arrangement.spacedBy(u * 12)) {
        options.forEachIndexed { n, label ->
            val chosen = saved?.value == n
            val right = saved != null && correct == n
            val wrong = saved != null && correct != null && chosen && !right
            val share = if (right || wrong) 100 else pct?.getOrNull(n) ?: if (chosen) 100 else 0
            val mark = if (saved == null) "" else if (wrong) "✕ " else if (chosen || right) "✓ " else ""
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(u * 76)
                    .clip(RoundedCornerShape(50))
                    .background(OPTION)
                    .clickable(enabled = saved == null, role = Role.RadioButton) { controller.answer(i, n) }
                    .semantics {
                        selected = chosen
                        contentDescription = pct?.getOrNull(n)?.let { InteractionLabels.pollOption(label, it) } ?: label
                    },
            ) {
                if (saved != null) {
                    Box(
                        Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(share / 100f)
                            .alpha(if (right || wrong) 0.35f else if (chosen) 0.5f else 0.3f)
                            .background(
                                when {
                                    right -> parseHex(Interactions.CORRECT_COLOR, Color.Green)
                                    wrong -> parseHex(Interactions.WRONG_COLOR, Color.Red)
                                    else -> accent
                                },
                            ),
                    )
                }
                Row(
                    Modifier.fillMaxSize().padding(horizontal = u * 24),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    BasicText(
                        mark + label,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = TextStyle(
                            color = INK,
                            fontSize = (u * 28).sp(),
                            fontWeight = FontWeight.SemiBold,
                            textAlign = if (saved == null) TextAlign.Center else TextAlign.Start,
                        ),
                        modifier = Modifier.weight(1f),
                    )
                    pct?.getOrNull(n)?.let {
                        BasicText(
                            "$it%",
                            style = TextStyle(color = INK, fontSize = (u * 24).sp(), fontWeight = FontWeight.SemiBold),
                            modifier = Modifier.padding(start = u * 12),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun SliderTrack(
    controller: ViewerController,
    i: Interaction,
    k: Interaction.Kind.Slider,
    saved: StoredAnswer?,
    accent: Color,
    u: Dp,
) {
    var value by remember(i.id) { mutableIntStateOf(saved?.value ?: 0) }
    val shown = saved?.value ?: value
    BoxWithConstraints(
        Modifier
            .fillMaxWidth()
            .height(u * 72)
            .semantics {
                contentDescription = InteractionLabels.slider(k.question)
                progressBarRangeInfo = ProgressBarRangeInfo(shown.toFloat(), 0f..100f, steps = 9)
                if (saved == null) {
                    setProgress { target ->
                        value = target.roundToInt().coerceIn(0, 100)
                        controller.answer(i, value)
                        true
                    }
                }
            }
            .then(
                if (saved != null) Modifier else Modifier.pointerInput(i.id) {
                    val thumb = (u * 72).toPx()
                    fun at(x: Float) = (((x - thumb / 2) / (size.width - thumb)) * 100).roundToInt().coerceIn(0, 100)
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        down.consume()
                        controller.hold(true)
                        value = at(down.position.x)
                        while (true) {
                            val event = awaitPointerEvent()
                            val change = event.changes.firstOrNull { it.id == down.id } ?: break
                            // The story's swipes never take this drag over.
                            change.consume()
                            if (!change.pressed) break
                            value = at(change.position.x)
                        }
                        controller.hold(false)
                        controller.answer(i, value)
                    }
                },
            ),
    ) {
        val track = maxWidth - u * 72
        fun at(v: Int) = u * 36 + track * (v / 100f)
        Box(Modifier.align(Alignment.CenterStart).fillMaxWidth().height(u * 14).clip(RoundedCornerShape(50)).background(RAIL))
        Box(Modifier.align(Alignment.CenterStart).width(at(shown)).height(u * 14).clip(RoundedCornerShape(50)).background(accent))
        saved?.results?.average?.let { avg ->
            Box(
                Modifier
                    .align(Alignment.CenterStart)
                    .offset(x = at(avg) - u * 14)
                    .size(u * 28)
                    .clip(CircleShape)
                    .background(accent)
                    .border(u * 4, Color.White, CircleShape),
            )
        }
        Box(Modifier.align(Alignment.CenterStart).offset(x = at(shown) - u * 36).size(u * 72), contentAlignment = Alignment.Center) {
            BasicText(k.emoji, style = TextStyle(fontSize = (u * 56).sp()))
        }
    }
}

@Composable
private fun CountdownRow(endsAtMs: Long, u: Dp) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val c = countdownParts(endsAtMs, now)
    LaunchedEffect(c.ended) {
        while (!c.ended) {
            delay(1000 - now % 1000)
            now = System.currentTimeMillis()
        }
    }
    if (c.ended) {
        BasicText(
            InteractionLabels.COUNTDOWN_ENDED,
            style = TextStyle(color = INK, fontSize = (u * 40).sp(), fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
            modifier = Modifier.fillMaxWidth(),
        )
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(u * 12)) {
        listOf(c.days, c.hours, c.minutes, c.seconds).forEachIndexed { n, v ->
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                BasicText(
                    v.toString().padStart(2, '0'),
                    style = TextStyle(color = INK, fontSize = (u * 56).sp(), fontWeight = FontWeight.Bold, fontFeatureSettings = "tnum"),
                )
                BasicText(
                    InteractionLabels.COUNTDOWN_UNITS[n],
                    style = TextStyle(color = UNIT, fontSize = (u * 18).sp()),
                    modifier = Modifier.padding(top = u * 4),
                )
            }
        }
    }
}
