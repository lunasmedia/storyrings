package com.lunasmedia.storyrings

import androidx.annotation.OptIn
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import com.lunasmedia.storyrings.core.ENERGIZED_PREVIEW_MS
import com.lunasmedia.storyrings.core.FeedStory

/**
 * Energized style: a story over a card's cover, a muted video or an image zooming in and out.
 * It fades in once it can show, so the cover stays until then (or if it can't load).
 */
@Composable
internal fun StoryPreview(story: FeedStory, onShown: () -> Unit = {}) {
    var shown by remember(story.url) { mutableStateOf(false) }
    LaunchedEffect(shown) { if (shown) onShown() }
    val alpha by animateFloatAsState(if (shown) 1f else 0f, tween(300), label = "preview")
    Box(Modifier.fillMaxSize().alpha(alpha)) {
        if (story.type == "video") {
            PreviewVideo(story.url) { shown = true }
        } else {
            ZoomingImage(story.url) { shown = true }
        }
    }
}

/** The image, zooming in to 110% and back out over the preview once it shows. */
@Composable
private fun ZoomingImage(url: String, onShown: () -> Unit) {
    var started by remember(url) { mutableStateOf(false) }
    val scale = remember(url) { Animatable(1f) }
    LaunchedEffect(started) {
        if (!started) return@LaunchedEffect
        val half = ENERGIZED_PREVIEW_MS / 2
        scale.animateTo(1.1f, tween(half, easing = FastOutSlowInEasing))
        scale.animateTo(1f, tween(half, easing = FastOutSlowInEasing))
    }
    RemoteImage(
        url,
        Modifier.fillMaxSize().graphicsLayer {
            scaleX = scale.value
            scaleY = scale.value
        },
        onResult = { ok ->
            if (ok) {
                started = true
                onShown()
            }
        },
    )
}

/** A story video playing once, muted, from the start; reports when its first frame shows. */
@OptIn(UnstableApi::class)
@Composable
private fun PreviewVideo(url: String, onReady: () -> Unit) {
    val context = LocalContext.current
    val player = remember(url) {
        ExoPlayer.Builder(context).build().apply {
            volume = 0f
            setMediaItem(MediaItem.fromUri(url))
            addListener(object : Player.Listener {
                override fun onRenderedFirstFrame() = onReady()
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
        modifier = Modifier.fillMaxSize(),
    )
}
