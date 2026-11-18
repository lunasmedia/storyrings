package com.lunasmedia.storyrings

import android.graphics.Matrix
import androidx.annotation.OptIn
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.graphics.Shadow
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.SweepGradientShader
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.lunasmedia.storyrings.core.FeedGroup
import com.lunasmedia.storyrings.core.FeedStory
import com.lunasmedia.storyrings.core.RingStyle
import com.lunasmedia.storyrings.core.StoriesLabels
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.sin

/** Energized cards: the circle in the middle is this share of the card's width. */
internal const val ENERGIZED_AVATAR_SHARE = 0.5f

/**
 * One item in the story bar: cover, ring, badge and title, in the dashboard's style. With [card]
 * (the Energized style) it's a story-shaped card instead: showing a still of the group's first
 * story (which plays as [preview] on its turn; the cover until the still loads), the circle in the middle (hidden while the story shows) and the title
 * inside.
 */
@Composable
internal fun StoryCircle(
    group: FeedGroup,
    width: Dp,
    height: Dp,
    radius: Dp,
    seen: Boolean,
    theme: StoriesTheme,
    textColor: Color,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
    /** The circle's bounds in the window, for the zoom transition to open from and close into. */
    onCircleBounds: ((Rect) -> Unit)? = null,
    /** Its viewer is opening (waiting for the first story): shown pressed. */
    opening: Boolean = false,
    /**
     * Energized style: its viewer is open, opened while this card previewed: the circle stays
     * aside until the preview shows again (or moves on to another card).
     */
    held: Boolean = false,
    /** Energized style: drawn as a story card; false = a circle. */
    card: Boolean = false,
    /** Energized style: the story previewing in this card now, if any. */
    preview: FeedStory? = null,
    /** Changes each time a preview starts, so the same story starts again. */
    previewTurn: Int = 0,
) {
    val a = group.appearance
    Column(
        // Items are wider than the ring by the title allowance, like the other SDKs.
        modifier = modifier
            .width(width + 12.dp)
            .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null, onClick = onTap)
            .clearAndSetSemantics {
                contentDescription = StoriesLabels.openGroup(group.title, group.stories.size, seen)
                role = Role.Button
            },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val bounds = Modifier.onGloballyPositioned { onCircleBounds?.invoke(it.boundsInWindow()) }
        if (card) {
            EnergizedCard(group, width, height, radius, seen, theme, preview, previewTurn, held, bounds.alpha(if (opening) 0.7f else 1f))
            return@Column
        }
        // Dimmed while its viewer is opening (waiting for the first story).
        CircleArt(group, width, height, radius, seen, bounds.alpha(if (opening) 0.7f else 1f))
        if (!a.title.hidden && !theme.hideTitles) {
            Spacer(Modifier.height(6.dp))
            val color = if (a.title.color == "inherit") textColor else parseHex(a.title.color, textColor)
            BasicText(
                group.title,
                style = theme.titleStyle.copy(
                    fontSize = theme.titleSize,
                    color = color,
                    fontWeight = FontWeight(a.title.weight.coerceIn(100, 900)),
                    textAlign = TextAlign.Center,
                ),
                maxLines = maxOf(1, a.title.maxLines),
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun EnergizedCard(
    group: FeedGroup,
    width: Dp,
    height: Dp,
    radius: Dp,
    seen: Boolean,
    theme: StoriesTheme,
    preview: FeedStory?,
    previewTurn: Int,
    held: Boolean,
    modifier: Modifier,
) {
    val a = group.appearance
    val avatar = width * ENERGIZED_AVATAR_SHARE
    Box(
        modifier
            .size(width, height)
            .clip(RoundedCornerShape(radius))
            .background(Color(0xFF222222)),
    ) {
        // A still of the group's first story (the one it previews): the image, or a video's first
        // frame. The cover fills the card only if there's no still to show: shown while the still
        // loads, it would flash up and then change.
        var stillFailed by remember(group.id) { mutableStateOf(false) }
        val first = group.stories.firstOrNull()
        if (first != null && !stillFailed) {
            RemoteImage(first.url, Modifier.fillMaxSize(), videoFrame = first.type == "video") { ok -> if (!ok) stillFailed = true }
        } else if (group.coverUrl.isNotEmpty()) {
            RemoteImage(group.coverUrl, Modifier.fillMaxSize())
        }
        // The circle (and its badge) gives way to the story while it shows, and stays aside while
        // the viewer opened from that preview is open (until the preview shows again).
        var shownTurn by remember { mutableStateOf<Int?>(null) }
        var keepAside by remember { mutableStateOf(false) }
        LaunchedEffect(held, preview == null) {
            if (held) keepAside = true else if (preview == null) keepAside = false
        }
        if (preview != null) {
            key(previewTurn) {
                StoryPreview(preview) {
                    shownTurn = previewTurn
                    keepAside = false
                }
            }
        }
        val aside = (preview != null && shownTurn == previewTurn) || held || keepAside
        val circleAlpha by animateFloatAsState(if (aside) 0f else 1f, tween(300), label = "circle")
        Box(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .fillMaxHeight(0.45f)
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.6f)))),
        )
        CircleArt(group, avatar, avatar, avatar / 2, seen, Modifier.align(Alignment.Center).alpha(circleAlpha))
        if (!a.title.hidden && !theme.hideTitles) {
            BasicText(
                group.title,
                style = theme.titleStyle.copy(
                    fontSize = theme.titleSize,
                    color = Color.White,
                    fontWeight = FontWeight(a.title.weight.coerceIn(100, 900)),
                    textAlign = TextAlign.Center,
                    shadow = Shadow(Color.Black.copy(alpha = 0.6f), Offset(0f, 2f), 6f),
                ),
                maxLines = maxOf(1, a.title.maxLines),
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.align(Alignment.BottomCenter).padding(start = 6.dp, end = 6.dp, bottom = 8.dp),
            )
        }
    }
}

/** The circle: cover, ring (style, animation, seen colour) and badge. */
@Composable
private fun CircleArt(group: FeedGroup, width: Dp, height: Dp, radius: Dp, seen: Boolean, modifier: Modifier) {
    val a = group.appearance
    val ring = a.ring
    val reduceMotion = LocalContext.current.animationsOff()
    val animates = ring.style != "none" && ring.animation != "none" && !(seen && ring.animateOnlyUnseen) && !reduceMotion
    val ringWidth = if (ring.style == "none") 0.dp else ring.width.dp
    val inset = ringWidth + if (ring.style == "none") 0.dp else ring.gap.dp
    val innerRadius = max(0f, (radius - inset).value).dp
    val label = a.badgeLabel(group.endsAtMs)
    Box(modifier.size(width, height)) {
        if (ring.style != "none" && ring.gapColor != "background" && ring.gapColor != "transparent") {
            Box(
                Modifier
                    .padding(ringWidth)
                    .fillMaxSize()
                    .background(parseHex(ring.gapColor, Color.Transparent), RoundedCornerShape(max(0f, (radius - ringWidth).value).dp)),
            )
        }
        Box(
            Modifier
                .padding(inset)
                .fillMaxSize()
                .clip(RoundedCornerShape(innerRadius))
                .background(Color(0xFFE5E5EA)),
        ) {
            if (group.coverUrl.isNotEmpty()) RemoteImage(group.coverUrl, Modifier.fillMaxSize())
            val video = group.coverVideoUrl
            if (video != null && !reduceMotion) CoverVideo(video)
        }
        if (ring.style != "none") {
            val t = if (animates) {
                val duration = ringSpeedMs[ring.speed] ?: 2400
                val transition = rememberInfiniteTransition(label = "ring")
                transition.animateFloat(
                    0f, 1f, infiniteRepeatable(tween(duration, easing = LinearEasing), RepeatMode.Restart), label = "phase",
                ).value
            } else {
                0f
            }
            Canvas(Modifier.fillMaxSize()) { drawRing(ring, seen, radius.toPx(), t) }
        }
        if (label != null) Badge(label, group, Modifier.align(if (a.badge.position == "top-right") Alignment.TopEnd else Alignment.BottomCenter))
    }
}

@Composable
private fun Badge(label: String, group: FeedGroup, modifier: Modifier) {
    val b = group.appearance.badge
    val topRight = b.position == "top-right"
    BasicText(
        label,
        style = androidx.compose.ui.text.TextStyle(
            color = parseHex(b.color, Color.White), fontSize = 9.5.sp, fontWeight = FontWeight.Bold,
        ),
        modifier = modifier
            .offset(x = if (topRight) 2.dp else 0.dp, y = if (topRight) (-2).dp else 6.dp)
            .background(parseHex(b.background, Color(0xFFE8175D)), RoundedCornerShape(8.dp))
            .border(1.5.dp, Color.White, RoundedCornerShape(8.dp))
            .padding(horizontal = 5.dp, vertical = 1.dp),
    )
}

/** The ring: gradient or solid, grey once seen, with the dashboard's animation at phase [t]. */
private fun DrawScope.drawRing(ring: RingStyle, seen: Boolean, radius: Float, t: Float) {
    val w = ring.width.toFloat() * density
    val inset = w / 2
    val corner = CornerRadius(max(0f, radius - inset))
    val topLeft = Offset(inset, inset)
    val ringSize = Size(size.width - w, size.height - w)
    fun stroke(brush: Brush, alpha: Float = 1f) =
        drawRoundRect(brush, topLeft, ringSize, corner, alpha = alpha, style = Stroke(w))

    val colors = ring.colors.map { parseHex(it, Color(0xFFD62976)) }.ifEmpty { listOf(Color(0xFFD62976)) }
    if (seen) return stroke(Brush.linearGradient(listOf(parseHex(ring.seenColor, Color(0xFFC7C7CC)), parseHex(ring.seenColor, Color(0xFFC7C7CC)))))
    val c = center
    when {
        ring.style == "solid" || colors.size == 1 -> stroke(Brush.linearGradient(listOf(colors[0], colors[0])))
        ring.animation == "rotate" -> stroke(object : ShaderBrush() {
            override fun createShader(size: Size): Shader = SweepGradientShader(c, colors + colors[0]).apply {
                setLocalMatrix(Matrix().apply { setRotate(t * 360f, c.x, c.y) })
            }
        })
        else -> {
            // CSS angles: 0° points up, 90° right.
            val rad = Math.toRadians(ring.angle - 90)
            val d = Offset((cos(rad) * size.width / 2).toFloat(), (sin(rad) * size.height / 2).toFloat())
            stroke(Brush.linearGradient(colors, start = c - d, end = c + d))
        }
    }
    when (ring.animation) {
        // A glow that grows outwards and fades, like the web's.
        "pulse" -> scale(1 + 0.3f * t) { stroke(Brush.linearGradient(listOf(colors[0], colors[0])), alpha = 0.75f * (1 - t)) }
        // A light band sweeping across the ring for the first 60% of each cycle.
        "shimmer" -> {
            val p = (t / 0.6f).coerceIn(0f, 1f)
            val x = -1.1f + 3.1f * p
            val half = size.width / 2
            stroke(Brush.linearGradient(
                listOf(Color.White.copy(alpha = 0f), Color.White.copy(alpha = 0.85f), Color.White.copy(alpha = 0f)),
                start = Offset(c.x + (x - 0.55f) * half, c.y),
                end = Offset(c.x + (x + 0.55f) * half, c.y),
            ))
        }
    }
}

/** Animated (GIF) covers: a looping muted video drawn over the still once its first frame shows. */
@OptIn(UnstableApi::class)
@Composable
private fun CoverVideo(url: String) {
    val context = LocalContext.current
    var ready by remember(url) { mutableStateOf(false) }
    val player = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            volume = 0f
            repeatMode = Player.REPEAT_MODE_ONE
            setMediaItem(MediaItem.fromUri(url))
            addListener(object : Player.Listener {
                override fun onRenderedFirstFrame() {
                    ready = true
                }
            })
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                useController = false
                resizeMode = AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
                this.player = player
            }
        },
        modifier = Modifier.fillMaxSize().alpha(if (ready) 1f else 0f),
    )
}
