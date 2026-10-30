package com.lunasmedia.storyrings

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.view.View
import androidx.annotation.OptIn
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.PointerEventType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.lunasmedia.storyrings.core.CloseReason
import com.lunasmedia.storyrings.core.FeedStory
import com.lunasmedia.storyrings.core.StoryLook
import com.lunasmedia.storyrings.core.StoriesLabels
import com.lunasmedia.storyrings.core.ViewerAction
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private const val OPEN_MS = 300
private const val CLOSE_MS = 300
private const val FADE_MS = 150

/** Arrives fast and settles (opening). */
private val Decelerate = CubicBezierEasing(0.2f, 0f, 0f, 1f)

/** Where the zoom transition opens from and closes into: a circle's bounds in the window and its corner radius (px). */
internal class ViewerOrigin(val bounds: Rect, val cornerPx: Float)

/**
 * Full-screen story viewer, over the app in its own window. With the zoom transition it springs
 * out of the tapped circle and goes back into the circle of the group being watched; with slide
 * (or when that circle isn't on screen) it slides up from the bottom and shrinks away towards
 * the bottom. Either way a close carries on from wherever a swipe down left the story. The app
 * behind is never dimmed: the story covers it while open and it shows around the story as it
 * moves. With "Remove animations" on, both are a short fade.
 */
@Composable
internal fun StoriesViewer(controller: ViewerController, origin: (Int) -> ViewerOrigin?, onFinished: (CloseReason) -> Unit) {
    val context = LocalContext.current
    val view = LocalView.current
    val reduceMotion = remember { context.animationsOff() }
    val scope = rememberCoroutineScope()
    // The app's own status bar icons (dark on a light screen, or light): kept until the story
    // covers the top of the screen, so the icons never turn white over the app.
    val appDarkIcons = remember {
        val activityWindow = view.context.findActivity()?.window
        activityWindow != null && WindowCompat.getInsetsController(activityWindow, activityWindow.decorView).isAppearanceLightStatusBars
    }
    // Zoom: the circle the story grows from (null = slide). Looked up again when it closes.
    var circle by remember(controller) { mutableStateOf(if (reduceMotion) null else origin(controller.shown.groupIndex)) }
    // Slide, opening: 1 = below the screen, 0 = in place.
    val slide = remember(controller) { Animatable(if (circle == null) 1f else 0f) }
    // Zoom: 0 = the circle, 1 = full screen (it overshoots a little as it springs).
    val grow = remember(controller) { Animatable(if (circle == null) 1f else 0f) }
    // Slide, closing: 0 = where it was, 1 = gone.
    val shrink = remember(controller) { Animatable(0f) }
    var closingFrom by remember(controller) { mutableStateOf<Float?>(null) }
    // Follows the finger while dragging down; springs back when let go (unless that closes it).
    val drag = remember(controller) { Animatable(0f) }
    val fingerDrag = controller.drag.toFloat()
    val fingerDown = controller.dragging
    LaunchedEffect(fingerDrag, fingerDown) {
        // Exactly under the finger while it's down; springs back only once it's lifted.
        if (fingerDown) drag.snapTo(fingerDrag) else drag.animateTo(0f, spring(stiffness = Spring.StiffnessMediumLow))
    }
    remember(controller) {
        controller.host = AndroidViewerHost(context, view) { reason ->
            // Where the story is now: a swipe down closes from where the finger let go.
            closingFrom = drag.value
            scope.launch {
                slide.stop()
                grow.stop()
                val into = if (reduceMotion || circle == null && slide.value > 0f) null else origin(controller.shown.groupIndex)
                if (into != null) {
                    // Back into the circle of the group being watched.
                    circle = into
                    grow.animateTo(0f, spring(dampingRatio = 0.92f, stiffness = 420f, visibilityThreshold = 0.002f))
                } else {
                    circle = null
                    shrink.animateTo(1f, tween(if (reduceMotion) FADE_MS else CLOSE_MS, easing = FastOutSlowInEasing))
                }
                onFinished(reason)
            }
        }
    }
    LaunchedEffect(controller) {
        if (circle != null) {
            grow.animateTo(1f, spring(dampingRatio = 0.82f, stiffness = 320f, visibilityThreshold = 0.002f))
        } else {
            slide.animateTo(0f, tween(if (reduceMotion) FADE_MS else OPEN_MS, easing = if (reduceMotion) LinearEasing else Decelerate))
        }
    }
    Dialog(
        onDismissRequest = controller::close, // Back
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false, dismissOnClickOutside = false),
    ) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        // Before the first frame: full screen, transparent around the story, no stock dialog
        // animation or dimming. The status bar stays shown, so nothing reflows.
        SideEffect {
            window ?: return@SideEffect
            window.setLayout(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT)
            window.setWindowAnimations(0)
            window.setDimAmount(0f)
            window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(android.graphics.Color.TRANSPARENT))
        }
        // Light status bar icons only while the story covers the top of the screen: not while it
        // opens or closes, nor once a drag pulls it below the status bar.
        // The status bar's height (it can read as 0 in this window before insets arrive).
        val density = LocalDensity.current
        val statusBarPx = maxOf(WindowInsets.statusBars.getTop(density).toFloat(), with(density) { 24.dp.toPx() })
        // Once a drag pulls the story fully below the status bar, the icons keep the app's style
        // until the finger is lifted, however it wobbles (no flipping back and forth).
        var dragUncoveredTop by remember(controller) { mutableStateOf(false) }
        if (controller.dragging && drag.value >= statusBarPx) dragUncoveredTop = true
        if (!controller.dragging) dragUncoveredTop = false
        val coversTop by remember(controller) {
            derivedStateOf {
                closingFrom == null && !dragUncoveredTop &&
                    (if (reduceMotion) slide.value < 0.5f else slide.value < 0.06f && grow.value > 0.97f)
            }
        }
        val lightBackgroundIcons = !coversTop && appDarkIcons
        // Read here (not only inside the effect), so it re-runs whenever the story covers or uncovers the top.
        LaunchedEffect(window, lightBackgroundIcons) {
            window ?: return@LaunchedEffect
            WindowCompat.getInsetsController(window, window.decorView).isAppearanceLightStatusBars = lightBackgroundIcons
        }
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val w = size.width
                    val h = size.height
                    if (reduceMotion) {
                        alpha = (1f - slide.value) * (1f - shrink.value)
                        return@graphicsLayer
                    }
                    val d = closingFrom ?: drag.value
                    // Dragging down: the story follows the finger and shrinks a little, with rounded corners.
                    val dragged = (d / h).coerceIn(0f, 1f)
                    val dragScale = 1f - 0.12f * dragged
                    val dragCorner = 16.dp.toPx() * minOf(1f, dragged * 8f)
                    val o = circle
                    if (o != null) {
                        // Zoom: the story's frame moves between the circle and the (dragged) screen.
                        val g = grow.value
                        val endW = w * dragScale
                        val endH = h * dragScale
                        val cardW = lerp(o.bounds.width, endW, g)
                        val cardH = lerp(o.bounds.height, endH, g)
                        val left = lerp(o.bounds.left, (w - endW) / 2, g)
                        val top = lerp(o.bounds.top, (h - endH) / 2 + d, g)
                        // Scaled to the frame's width; clipped to its height, centred.
                        val scale = cardW / w
                        val visibleH = cardH / scale
                        val inset = maxOf(0f, (h - visibleH) / 2)
                        transformOrigin = TransformOrigin(0f, 0f)
                        scaleX = scale
                        scaleY = scale
                        translationX = left
                        translationY = top - inset * scale
                        val corner = maxOf(0f, lerp(o.cornerPx, dragCorner, g)) / scale
                        shape = InsetShape(inset, corner)
                        clip = true
                        // Closing: hands over to the circle's cover as it lands.
                        alpha = if (closingFrom != null) (g / 0.25f).coerceIn(0f, 1f) else 1f
                        return@graphicsLayer
                    }
                    val c = shrink.value
                    // Slide closing: shrinks towards the bottom centre of the screen, fading out at the end.
                    val scale = lerp(dragScale, 0.12f, c)
                    val centreY = lerp(h / 2 + d, h * 0.92f, c)
                    scaleX = scale
                    scaleY = scale
                    translationY = centreY - h / 2 + slide.value * h
                    alpha = 1f - ((c - 0.6f) / 0.4f).coerceIn(0f, 1f)
                    val corner = if (dragged > 0f || c > 0f) 16.dp.toPx() / scale * minOf(1f, dragged * 8f + c * 4f) else 0f
                    shape = RoundedCornerShape(corner)
                    clip = corner > 0f
                },
        ) {
            ViewerContent(controller)
        }
    }
}

/** A rounded rectangle inset from the top and bottom: the story clipped to the zoom frame's height. */
private class InsetShape(private val inset: Float, private val corner: Float) : androidx.compose.ui.graphics.Shape {
    override fun createOutline(size: Size, layoutDirection: androidx.compose.ui.unit.LayoutDirection, density: androidx.compose.ui.unit.Density) =
        androidx.compose.ui.graphics.Outline.Rounded(
            androidx.compose.ui.geometry.RoundRect(0f, inset, size.width, size.height - inset, CornerRadius(corner)),
        )
}

private fun lerp(a: Float, b: Float, t: Float) = a + (b - a) * t

@Composable
private fun ViewerContent(controller: ViewerController) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(controller) {
        controller.start()
        while (true) withFrameMillis(controller::frame)
    }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> controller.setBackground(true)
                Lifecycle.Event.ON_START -> controller.setBackground(false)
                Lifecycle.Event.ON_RESUME -> controller.shareDone()
                else -> Unit
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    val touchArea = remember { arrayOfNulls<LayoutCoordinates>(1) }
    // The last open state, so the story stays on screen while the viewer animates closed.
    val state = controller.shown
    // Only for loads that take a while, so quick ones don't flash it.
    var spinner by remember(state.seq) { mutableStateOf(false) }
    LaunchedEffect(state.seq) {
        delay(400)
        spinner = true
    }
    Box(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .semantics { paneTitle = if (state.open) StoriesLabels.viewer(controller.group.title) else "" },
    ) {
        if (!state.open) return@Box
        val g = controller.group
        val s = controller.story
        val density = LocalDensity.current
        // The cover shows behind a story that's still loading.
        if (!state.displayed) {
            RemoteImage(g.coverUrl, Modifier.fillMaxSize().alpha(0.5f))
        }
        // The story covers the whole screen, under the status and navigation bars, as the studio
        // previews it on full phone screens; the header and button stay clear of them.
        Box(Modifier.fillMaxSize()) {
            BoxWithConstraints(
                Modifier
                    .fillMaxSize()
                    .onGloballyPositioned { touchArea[0] = it }
                    .pointerInput(controller) {
                        // Window positions, not local ones: this area moves with the story while it's
                        // dragged, and measuring against it would feed the drag back into itself (the
                        // story jumping back and forth under a slow or held finger).
                        fun window(o: Offset): Offset = touchArea[0]?.takeIf { it.isAttached }?.localToWindow(o) ?: o
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent()
                                val change = event.changes.firstOrNull() ?: continue
                                val p = window(change.position)
                                // Movement between frames arrives batched (in `historical`, or folded into
                                // the release on slow devices): feed all of it, or a fast swipe reads as a tap.
                                fun moves() {
                                    change.historical.forEach {
                                        val h = window(it.position)
                                        controller.gestures.move(h.x.toDouble(), h.y.toDouble())
                                    }
                                    controller.gestures.move(p.x.toDouble(), p.y.toDouble())
                                }
                                when (event.type) {
                                    PointerEventType.Press -> controller.gestures.down(p.x.toDouble(), p.y.toDouble(), change.uptimeMillis)
                                    PointerEventType.Move -> moves()
                                    PointerEventType.Release ->
                                        if (change.isConsumed) {
                                            controller.gestures.cancel()
                                        } else {
                                            moves()
                                            controller.gestures.up(p.x.toDouble(), p.y.toDouble(), change.uptimeMillis, size.width.toDouble())
                                        }
                                    else -> Unit
                                }
                            }
                        }
                    }
                    .clearAndSetSemantics {
                        contentDescription = s.alt
                        customActions = listOf(
                            CustomAccessibilityAction(StoriesLabels.PREVIOUS) { controller.dispatch(ViewerAction.Prev); true },
                            CustomAccessibilityAction(StoriesLabels.NEXT) { controller.dispatch(ViewerAction.Next()); true },
                        )
                    },
            ) {
                // A new story (seq) gets fresh media.
                androidx.compose.runtime.key(state.seq) { StoryMedia(controller, s, state.seq) }
                // The previous story stays on screen until this one has loaded.
                val previous = controller.previous
                if (previous != null && !state.displayed) {
                    Box(Modifier.fillMaxSize().background(gapBrush(previous.look)))
                    RemoteImage(
                        previous.url,
                        Modifier.fillMaxSize(),
                        contentScale = if (previous.look.fills) ContentScale.Crop else ContentScale.Fit,
                    )
                }
            }
            if (spinner && state.buffering && !state.displayed) Spinner(Modifier.align(Alignment.Center))
            // The button and stickers stay with the photo on screen (see onScreen).
            val o = controller.onScreen
            if (o.interactions.isNotEmpty()) Stickers(controller, o)
            Column(
                Modifier
                    .fillMaxSize()
                    .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom)),
            ) {
                Header(controller, g.coverUrl, s.title ?: g.title, s.type == "video")
                Spacer(Modifier.weight(1f))
                val label = o.ctaLabel
                if (label != null && o.ctaUrl != null) {
                    CtaButton(
                        label,
                        o.ctaStyle,
                        controller::cta,
                        Modifier.align(Alignment.CenterHorizontally).padding(bottom = 24.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun StoryMedia(controller: ViewerController, story: FeedStory, seq: Int) {
    // Fill covers the screen; fit shows all of it, with the gaps in the story's colours.
    val look = story.look
    Box(Modifier.fillMaxSize().background(gapBrush(look)))
    if (story.type == "video") {
        VideoStory(controller, story.url, seq, look.fills)
        // A designed video's text and stickers, fitted as the story image would be.
        look.overlay?.let { overlay ->
            RemoteImage(overlay, Modifier.fillMaxSize(), contentScale = if (look.fills) ContentScale.Crop else ContentScale.Fit)
        }
    } else {
        RemoteImage(
            story.url,
            Modifier.fillMaxSize(),
            contentScale = if (look.fills) ContentScale.Crop else ContentScale.Fit,
            onResult = { ok -> if (ok) controller.mediaReady(seq) else controller.mediaFailed(seq) },
        )
    }
}

@OptIn(UnstableApi::class)
@Composable
private fun VideoStory(controller: ViewerController, url: String, seq: Int, fills: Boolean) {
    val context = LocalContext.current
    val player = remember(url, seq) {
        ExoPlayer.Builder(context).build().apply {
            setMediaItem(MediaItem.fromUri(url))
            var ready = false
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    when (state) {
                        Player.STATE_READY -> if (!ready) {
                            ready = true
                            controller.mediaReady(seq, duration.takeIf { it > 0 }?.toDouble())
                        } else {
                            controller.mediaReady(seq)
                        }
                        Player.STATE_BUFFERING -> if (ready) controller.mediaLoading(seq)
                        Player.STATE_ENDED -> controller.mediaEnded(seq)
                    }
                }

                override fun onPlayerError(error: PlaybackException) = controller.mediaFailed(seq)
            })
            prepare()
        }
    }
    DisposableEffect(player) { onDispose { player.release() } }
    player.volume = if (controller.muted) 0f else 1f
    player.playWhenReady = controller.playing
    AndroidView(
        factory = { ctx ->
            PlayerView(ctx).apply {
                useController = false
                resizeMode = if (fills) AspectRatioFrameLayout.RESIZE_MODE_ZOOM else AspectRatioFrameLayout.RESIZE_MODE_FIT
                // The gap colours behind show through around a video shown whole.
                setShutterBackgroundColor(android.graphics.Color.TRANSPARENT)
                setBackgroundColor(android.graphics.Color.TRANSPARENT)
                this.player = player
            }
        },
        modifier = Modifier.fillMaxSize(),
    )
}

@Composable
private fun Header(controller: ViewerController, coverUrl: String, title: String, video: Boolean) {
    Column(
        Modifier
            .fillMaxWidth()
            // Reaches up behind the status bar, keeping it readable over light stories.
            .background(Brush.verticalGradient(listOf(Color.Black.copy(alpha = 0.4f), Color.Transparent)))
            .windowInsetsPadding(WindowInsets.safeDrawing.only(WindowInsetsSides.Top))
            .padding(start = 10.dp, end = 4.dp, top = 8.dp, bottom = 14.dp),
    ) {
        Row(Modifier.fillMaxWidth().clearAndSetSemantics {}, horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            for (fill in controller.progress) {
                Box(Modifier.weight(1f).height(2.5.dp).clip(RoundedCornerShape(2.dp)).background(Color.White.copy(alpha = 0.3f))) {
                    Box(Modifier.fillMaxHeight().fillMaxWidth(fill.toFloat()).background(Color.White))
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            RemoteImage(coverUrl, Modifier.size(32.dp).clip(CircleShape))
            Spacer(Modifier.width(8.dp))
            BasicText(
                title,
                style = TextStyle(color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.SemiBold),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            if (controller.canShare) IconButton(StoriesLabels.SHARE, ViewerIcons.share, controller::share)
            IconButton(
                if (controller.userPaused) StoriesLabels.PLAY else StoriesLabels.PAUSE,
                if (controller.userPaused) ViewerIcons.play else ViewerIcons.pause,
                controller::toggleUserPause,
            )
            if (video) {
                IconButton(
                    if (controller.muted) StoriesLabels.UNMUTE else StoriesLabels.MUTE,
                    if (controller.muted) ViewerIcons.volumeOff else ViewerIcons.volumeUp,
                    controller::toggleMute,
                )
            }
            IconButton(StoriesLabels.CLOSE, ViewerIcons.close, controller::close)
        }
    }
}

@Composable
private fun IconButton(label: String, icon: ImageVector, onClick: () -> Unit) {
    Box(
        Modifier
            .size(44.dp)
            .clickable(role = Role.Button, onClickLabel = label, onClick = onClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Image(icon, contentDescription = null, modifier = Modifier.size(22.dp), colorFilter = ColorFilter.tint(Color.White))
    }
}

@Composable
private fun Spinner(modifier: Modifier) {
    val transition = rememberInfiniteTransition(label = "spinner")
    val alpha by transition.animateFloat(0.2f, 0.7f, infiniteRepeatable(tween(600), RepeatMode.Reverse), label = "alpha")
    Box(modifier.size(28.dp).alpha(alpha).clip(CircleShape).background(Color.White).semantics { contentDescription = StoriesLabels.LOADING })
}

private tailrec fun Context.findActivity(): android.app.Activity? = when (this) {
    is android.app.Activity -> this
    is android.content.ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** Announcements, links, the share sheet and closing, for a real screen. */
private class AndroidViewerHost(
    private val context: Context,
    private val view: View,
    private val onFinished: (CloseReason) -> Unit,
) : ViewerHost {
    private var finished = false

    @Suppress("DEPRECATION")
    override fun announce(text: String) = view.announceForAccessibility(text)

    override fun openUrl(url: String) {
        runCatching {
            context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    override fun share(text: String, title: String, shared: () -> Unit) {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, text)
            putExtra(Intent.EXTRA_SUBJECT, title)
        }
        // The chooser tells us when a target was picked: that's the share.
        val action = "com.lunasmedia.storyrings.SHARED.${System.nanoTime()}"
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                shared()
                runCatching { context.applicationContext.unregisterReceiver(this) }
            }
        }
        ContextCompat.registerReceiver(context.applicationContext, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)
        val callback = PendingIntent.getBroadcast(context, 0, Intent(action).setPackage(context.packageName), flags)
        runCatching {
            context.startActivity(Intent.createChooser(send, title, callback.intentSender).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    override fun finish(reason: CloseReason) {
        if (finished) return
        finished = true
        onFinished(reason)
    }
}

/** What shows in the gaps around a story shown whole: its colours, top to bottom (or black). */
private fun gapBrush(look: StoryLook): Brush =
    if (look.fillTop != null && look.fillBottom != null) {
        Brush.verticalGradient(listOf(parseHex(look.fillTop, Color.Black), parseHex(look.fillBottom, Color.Black)))
    } else {
        SolidColor(Color.Black)
    }
