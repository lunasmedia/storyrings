package com.stories.sdk

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.stories.core.AnswerResults
import com.stories.core.AnswerStore
import com.stories.core.CloseReason
import com.stories.core.Feed
import com.stories.core.FeedGroup
import com.stories.core.FeedStory
import com.stories.core.GestureHandlers
import com.stories.core.GestureRecognizer
import com.stories.core.Interaction
import com.stories.core.SeenStore
import com.stories.core.StartStoryIndex
import com.stories.core.StoredAnswer
import com.stories.core.StoriesLabels
import com.stories.core.StoryEvent
import com.stories.core.SwipeDirection
import com.stories.core.ViewerAction
import com.stories.core.ViewerState
import com.stories.core.actionEvents
import com.stories.core.appShareUrl
import com.stories.core.isAllowedCtaUrl
import com.stories.core.openViewer
import com.stories.core.progressSegments
import com.stories.core.reduce
import com.stories.core.transitionEvents

class StoryOpenEvent(val groupId: String, val storyId: String, val groupIndex: Int, val storyIndex: Int, val groupTitle: String)

/** A story button was tapped. [close] closes the viewer (useful when you navigate yourself). */
class CtaClickEvent(val url: String, val label: String, val groupId: String, val storyId: String, val close: () -> Unit)

/** [url]: your share link from the dashboard with {group} and {story} filled in; [title]: the story's name or group title. */
class ShareEvent(val url: String, val title: String, val groupId: String, val storyId: String)

/** What the SDK does after your `onCtaClick`. */
enum class CtaResult {
    /** You handled the link: the SDK doesn't open it. */
    HANDLED,
    /** The SDK opens it (https links, or your app's deep-link schemes). */
    DEFAULT,
}

/** What the SDK does after your `onShare`. */
enum class ShareResult {
    /** You shared it: the SDK doesn't show the share sheet. */
    HANDLED,
    /** The SDK shows the system share sheet. */
    DEFAULT,
}

class ViewerCallbacks(
    val onStoryOpen: ((StoryOpenEvent) -> Unit)? = null,
    val onCtaClick: ((CtaClickEvent) -> CtaResult)? = null,
    val onShare: ((ShareEvent) -> ShareResult)? = null,
)

/** What the controller asks of the screen it's drawn on. */
internal interface ViewerHost {
    fun announce(text: String)
    fun openUrl(url: String)
    /** Shows the share sheet; calls `shared` if the person picked where to share. */
    fun share(text: String, title: String, shared: () -> Unit)
    fun finish(reason: CloseReason)
}

/** Video sound preference for the session: once unmuted, later videos play with sound too. */
private var sessionMuted = true

private enum class PauseReason { USER, HOLD, BACKGROUND, SHARE }

/**
 * Drives the viewer: navigation, timing and analytics come from the core state machine
 * (spec/cases/viewer.json); the screen draws it and feeds it touches, frames and media events.
 * Plain Kotlin, so its behaviour is tested on the JVM.
 */
internal class ViewerController(
    val feed: Feed,
    groupIndex: Int,
    private val seen: SeenStore,
    private val track: (StoryEvent) -> Unit,
    private val callbacks: ViewerCallbacks,
    /** Polls, quizzes and sliders: answers kept on this device, and how to send one. */
    val answers: AnswerStore? = null,
    private val sendAnswer: ((String, String, Int, (AnswerResults?) -> Unit) -> Unit)? = null,
) {
    /** Changes when an answer (or its results) arrives, so the stickers redraw. */
    var answersVersion by mutableStateOf(0)
        private set

    var host: ViewerHost? = null

    val groups = feed.viewerGroups
    private val start: StartStoryIndex = { seen.firstUnseenIndex(groups[it].stories.map { s -> s.id }) }
    // Snapshot state: composables reading these redraw when they change.
    var state: ViewerState by mutableStateOf(openViewer(groups, groupIndex, start))
        private set
    /** The last open state: what's drawn, including while the viewer animates closed. */
    var shown: ViewerState by mutableStateOf(state)
        private set
    var drag by mutableStateOf(0.0)
        private set
    /**
     * A finger is down and has moved. False once it's lifted: only then does a story pulled down
     * spring back. Moving back above the start point while still dragging just gives a drag of 0.
     */
    var dragging by mutableStateOf(false)
        private set
    var muted by mutableStateOf(sessionMuted)
        private set
    /**
     * The photo story shown before this one, drawn over it until it has loaded (so a story still
     * loading never shows black). Only photos: a video's player belongs to the current story.
     */
    var previous by mutableStateOf<FeedStory?>(null)
        private set
    private var pauses by mutableStateOf(emptySet<PauseReason>())
    private var done = false
    private var started = false
    private var lastFrameMs: Long? = null

    val gestures = GestureRecognizer(GestureHandlers(
        onTap = { x ->
            pauses -= PauseReason.HOLD
            syncPause()
            dispatch(if (x < 0.3) ViewerAction.Prev else ViewerAction.Next())
        },
        onPress = { setPaused(PauseReason.HOLD, true) },
        onRelease = { setPaused(PauseReason.HOLD, false) },
        onSwipe = { direction ->
            pauses -= PauseReason.HOLD
            syncPause()
            when (direction) {
                SwipeDirection.LEFT -> dispatch(ViewerAction.NextGroup)
                SwipeDirection.RIGHT -> dispatch(ViewerAction.PrevGroup)
                SwipeDirection.DOWN -> close()
                // A swipe-up button: swiping up anywhere on the story opens its link.
                SwipeDirection.UP -> if (onScreen.ctaLabel != null && onScreen.ctaStyle.isSwipe) cta()
            }
        },
        onDrag = { dx, dy ->
            // (0, 0) is the recogniser saying the finger was lifted (or the touch cancelled).
            val lifted = dx == 0.0 && dy == 0.0
            dragging = !lifted
            drag = if (lifted) 0.0 else maxOf(0.0, dy)
        },
    ))

    init {
        transitionEvents(ViewerState.CLOSED, state, groups).forEach(track)
    }

    val group: FeedGroup get() = feed.groups[shown.groupIndex]
    val story: FeedStory get() = group.stories[shown.storyIndex]
    /**
     * The story whose photo is on screen: the previous one until this one has loaded. Its button
     * and stickers go with it, so they never change before the photo does.
     */
    val onScreen: FeedStory get() = previous?.takeIf { !shown.displayed } ?: story
    private val onScreenGroup: FeedGroup
        get() = onScreen.let { s -> feed.groups.firstOrNull { g -> g.stories.any { it.id == s.id } } } ?: group
    val userPaused: Boolean get() = PauseReason.USER in pauses
    val canShare: Boolean get() = feed.sharing && feed.shareLink != null
    val progress: List<Double> get() = progressSegments(shown, groups)

    /** The screen is showing: starts the first story. */
    fun start() {
        if (started || done) return
        started = true
        if (!state.open) return finish(CloseReason.COMPLETED)
        storyStarted()
    }

    fun dispatch(action: ViewerAction) {
        val prev = state
        if (!prev.open || done) return
        actionEvents(prev, action, groups).forEach(track)
        val next = reduce(prev, action, groups, start)
        if (next == prev) return
        state = next
        if (next.open) shown = next
        transitionEvents(prev, next, groups).forEach(track)
        if (!next.open) return finish(next.closeReason ?: CloseReason.USER)
        if (next.seq != prev.seq) {
            if (prev.displayed) {
                val before = feed.groups[prev.groupIndex].stories[prev.storyIndex]
                previous = before.takeIf { it.type == "image" }
            }
            // A hold or pause doesn't carry over to a new story.
            pauses -= PauseReason.USER
            pauses -= PauseReason.HOLD
            storyStarted()
        }
    }

    /** A display frame at [frameMs] (milliseconds, any clock). */
    fun frame(frameMs: Long) {
        val last = lastFrameMs
        lastFrameMs = frameMs
        if (last != null && frameMs > last) dispatch(ViewerAction.Tick((frameMs - last).toInt()))
    }

    private fun setPaused(reason: PauseReason, on: Boolean) {
        if (on) pauses += reason else pauses -= reason
        // In the background the story is off screen (viewability restarts).
        dispatch(if (PauseReason.BACKGROUND in pauses) ViewerAction.Hide else ViewerAction.Show)
        syncPause()
    }

    private fun syncPause() {
        dispatch(if (pauses.isEmpty()) ViewerAction.Resume else ViewerAction.Pause)
    }

    fun toggleUserPause() = setPaused(PauseReason.USER, !userPaused)

    /** Dragging the emoji slider holds the story. */
    fun hold(on: Boolean) = setPaused(PauseReason.HOLD, on)

    /** Keeps the answer, shows it at once, then the results once they arrive. */
    fun answer(interaction: Interaction, value: Int) {
        val storyId = story.id
        answers?.set(storyId, interaction.id, StoredAnswer(value))
        answersVersion++
        sendAnswer?.invoke(storyId, interaction.id, value) { results ->
            if (results == null) return@invoke
            answers?.set(storyId, interaction.id, StoredAnswer(value, results))
            answersVersion++
        }
    }

    /** The app went to the background / came back. */
    fun setBackground(on: Boolean) = setPaused(PauseReason.BACKGROUND, on)

    /** The share sheet closed (the app is back in front). */
    fun shareDone() {
        if (PauseReason.SHARE in pauses) setPaused(PauseReason.SHARE, false)
    }

    fun close() = dispatch(ViewerAction.Close)

    private fun finish(reason: CloseReason) {
        if (done) return
        done = true
        host?.finish(reason)
    }

    /** A story started: seen state, callbacks, announcements. The screen loads its media. */
    private fun storyStarted() {
        val g = group
        val s = story
        seen.markSeen(s.id)
        callbacks.onStoryOpen?.invoke(StoryOpenEvent(g.id, s.id, state.groupIndex, state.storyIndex, g.title))
        val name = s.title ?: g.title
        host?.announce(buildString {
            append(StoriesLabels.storyPosition(g.title, state.storyIndex, g.stories.size))
            if (name != g.title) append(", ").append(name)
            if (s.alt.isNotEmpty()) append(". ").append(s.alt)
        })
    }

    // Media events from the screen, for story `seq`.

    fun mediaReady(seq: Int, durationMs: Double? = null) {
        if (seq == state.seq) dispatch(ViewerAction.MediaReady(durationMs))
    }

    fun mediaFailed(seq: Int) {
        if (seq == state.seq && state.buffering) dispatch(ViewerAction.MediaReady(failed = true))
    }

    fun mediaLoading(seq: Int) {
        if (seq == state.seq) dispatch(ViewerAction.MediaLoading)
    }

    fun mediaEnded(seq: Int) {
        if (seq == state.seq) dispatch(ViewerAction.Next(auto = true))
    }

    fun toggleMute() {
        sessionMuted = !sessionMuted
        muted = sessionMuted
    }

    /** Whether the current video should be playing. */
    val playing: Boolean get() = state.open && !state.paused && !state.hidden

    // Actions

    fun cta() {
        val url = onScreen.ctaUrl ?: return
        openLink(onScreen.ctaLabel ?: "", url)
    }

    /** The story button, or a link sticker: both count as a button tap and follow the same rules. */
    fun openLink(label: String, url: String) {
        val g = onScreenGroup
        val s = onScreen
        track(StoryEvent("cta_click", g.id, s.id))
        val result = callbacks.onCtaClick?.invoke(CtaClickEvent(url, label, g.id, s.id, ::close))
        if (result == CtaResult.HANDLED || !state.open) return
        if (isAllowedCtaUrl(url, feed.deepLinkSchemes)) host?.openUrl(url)
    }

    fun share() {
        val link = feed.shareLink
        if (!canShare || link == null) return
        val g = group
        val s = story
        val url = appShareUrl(link, g.id, s.id)
        val title = s.title ?: g.title
        val event = StoryEvent("share", g.id, s.id)
        if (callbacks.onShare?.invoke(ShareEvent(url, title, g.id, s.id)) == ShareResult.HANDLED) {
            track(event)
            return
        }
        val host = host ?: return
        // The share sheet covers the story, so it waits.
        setPaused(PauseReason.SHARE, true)
        host.share("$title\n$url", title) { track(event) }
    }
}
