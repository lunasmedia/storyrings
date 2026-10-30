package com.lunasmedia.storyrings.core

// The story viewer as a pure state machine: a port of `@stories/core`'s machine.ts.
// The UI dispatches actions from taps, swipes and timers and draws whatever state comes
// back. Behaviour is pinned by spec/cases/viewer.json.

/** A story as far as the viewer is concerned. `type` is "image" or "video" (the viewability rule). */
data class ViewerStory(val id: String, val durationMs: Int, val type: String = "image")

data class ViewerGroup(val id: String, val stories: List<ViewerStory>)

/**
 * MRC/IAB viewability (docs/metrics.md): images need 1 s on screen, videos 2 s of continuous
 * playback, after the media has rendered.
 */
object Viewable {
    const val IMAGE_MS = 1000
    const val VIDEO_MS = 2000
}

enum class CloseReason(val json: String) { USER("user"), COMPLETED("completed") }

data class ViewerState(
    val open: Boolean,
    val groupIndex: Int,
    val storyIndex: Int,
    /** Time shown so far for the current story. */
    val elapsedMs: Int,
    val durationMs: Int,
    /** Paused by the person (hold, pause button). */
    val paused: Boolean,
    /** Media is loading; the timer doesn't run. */
    val buffering: Boolean,
    /** The current story's media has rendered (stays false if it failed). */
    val displayed: Boolean,
    /** The viewer is off screen (app in the background). */
    val hidden: Boolean,
    /** Continuous viewable time of the current story so far. */
    val viewableMs: Int,
    /** The current story met the viewability rule; analytics count it as viewed. */
    val viewed: Boolean,
    val closeReason: CloseReason?,
    /** Goes up each time a story starts (including restarting one): reload media when it changes. */
    val seq: Int,
) {
    fun toJson(): Map<String, Any?> = linkedMapOf(
        "open" to open, "groupIndex" to groupIndex, "storyIndex" to storyIndex,
        "elapsedMs" to elapsedMs, "durationMs" to durationMs, "paused" to paused,
        "buffering" to buffering, "displayed" to displayed, "hidden" to hidden,
        "viewableMs" to viewableMs, "viewed" to viewed, "closeReason" to closeReason?.json, "seq" to seq,
    )

    companion object {
        val CLOSED = ViewerState(
            open = false, groupIndex = 0, storyIndex = 0, elapsedMs = 0, durationMs = 0, paused = false,
            buffering = false, displayed = false, hidden = false, viewableMs = 0, viewed = false,
            closeReason = null, seq = 0,
        )

        internal fun closed(reason: CloseReason, seq: Int) = CLOSED.copy(closeReason = reason, seq = seq)
    }
}

sealed interface ViewerAction {
    /** Next story. `auto`: the story ended by itself (a video finished), not a tap. */
    data class Next(val auto: Boolean = false) : ViewerAction
    data object Prev : ViewerAction
    data object NextGroup : ViewerAction
    data object PrevGroup : ViewerAction
    data class Tick(val ms: Int) : ViewerAction
    data object Pause : ViewerAction
    data object Resume : ViewerAction
    data object MediaLoading : ViewerAction
    /** Media can play. `failed`: it couldn't load; the timer runs anyway so the viewer moves on. */
    data class MediaReady(val durationMs: Double? = null, val failed: Boolean = false) : ViewerAction
    /** The viewer went off screen / came back (app backgrounded). */
    data object Hide : ViewerAction
    data object Show : ViewerAction
    data object Close : ViewerAction
}

/** Story to start at when entering a group going forward (e.g. the first unseen one). */
typealias StartStoryIndex = (groupIndex: Int) -> Int

private fun show(s: ViewerState, groups: List<ViewerGroup>, groupIndex: Int, storyIndex: Int): ViewerState {
    val story = groups.getOrNull(groupIndex)?.stories?.getOrNull(storyIndex)
        ?: return ViewerState.closed(CloseReason.COMPLETED, s.seq)
    return ViewerState(
        open = true, groupIndex = groupIndex, storyIndex = storyIndex, elapsedMs = 0,
        durationMs = story.durationMs, paused = false, buffering = true, displayed = false,
        hidden = s.hidden, viewableMs = 0, viewed = false, closeReason = null, seq = s.seq + 1,
    )
}

private fun entryIndex(groups: List<ViewerGroup>, groupIndex: Int, start: StartStoryIndex?): Int {
    val count = groups.getOrNull(groupIndex)?.stories?.size ?: 0
    val wanted = start?.invoke(groupIndex) ?: 0
    return if (wanted in 0 until count) wanted else 0
}

/** Opens the viewer on a group, at its start story. */
fun openViewer(groups: List<ViewerGroup>, groupIndex: Int, startStoryIndex: StartStoryIndex? = null): ViewerState {
    if (groups.getOrNull(groupIndex)?.stories.isNullOrEmpty()) return ViewerState.CLOSED
    return show(ViewerState.CLOSED, groups, groupIndex, entryIndex(groups, groupIndex, startStoryIndex))
}

private fun nextGroup(s: ViewerState, groups: List<ViewerGroup>, start: StartStoryIndex?): ViewerState {
    val g = s.groupIndex + 1
    if (g >= groups.size) return ViewerState.closed(CloseReason.COMPLETED, s.seq)
    return show(s, groups, g, entryIndex(groups, g, start))
}

/** Continuous playback restarts for a not-yet-viewed video; images keep their count. */
private fun restartVideo(s: ViewerState, group: ViewerGroup): Int =
    if (!s.viewed && group.stories.getOrNull(s.storyIndex)?.type == "video") 0 else s.viewableMs

fun reduce(
    s: ViewerState,
    action: ViewerAction,
    groups: List<ViewerGroup>,
    startStoryIndex: StartStoryIndex? = null,
): ViewerState {
    if (!s.open) return s
    val group = groups.getOrNull(s.groupIndex) ?: return ViewerState.closed(CloseReason.USER, s.seq)
    val lastStory = group.stories.size - 1

    return when (action) {
        is ViewerAction.Next ->
            if (s.storyIndex < lastStory) show(s, groups, s.groupIndex, s.storyIndex + 1)
            else nextGroup(s, groups, startStoryIndex)

        ViewerAction.Prev -> when {
            s.storyIndex > 0 -> show(s, groups, s.groupIndex, s.storyIndex - 1)
            // Like Instagram: back from a group's first story lands on the previous group's last.
            s.groupIndex > 0 -> show(s, groups, s.groupIndex - 1, groups[s.groupIndex - 1].stories.size - 1)
            // Very first story: restart it.
            else -> show(s, groups, 0, 0)
        }

        ViewerAction.NextGroup -> nextGroup(s, groups, startStoryIndex)

        ViewerAction.PrevGroup -> show(s, groups, if (s.groupIndex > 0) s.groupIndex - 1 else 0, 0)

        is ViewerAction.Tick -> {
            val ms = action.ms
            if (ms <= 0) return s
            val video = group.stories.getOrNull(s.storyIndex)?.type == "video"
            // Images are viewable while on screen (even when held paused); videos only while playing.
            val accruing = s.displayed && !s.viewed && !s.hidden && (!video || (!s.paused && !s.buffering))
            val viewable = if (accruing) s.viewableMs + ms else s.viewableMs
            val justViewed = accruing && viewable >= (if (video) Viewable.VIDEO_MS else Viewable.IMAGE_MS)
            if (s.paused || s.buffering) {
                return if (accruing) s.copy(viewableMs = viewable, viewed = justViewed) else s
            }
            val elapsed = s.elapsedMs + ms
            when {
                // Report the view before moving on, so a story that ends right as it qualifies counts.
                justViewed -> s.copy(viewableMs = viewable, viewed = true, elapsedMs = minOf(elapsed, s.durationMs))
                elapsed >= s.durationMs -> reduce(s, ViewerAction.Next(), groups, startStoryIndex)
                else -> s.copy(elapsedMs = elapsed, viewableMs = viewable)
            }
        }

        // Off screen breaks continuity: the count starts again when it's back.
        ViewerAction.Hide -> if (s.hidden) s else s.copy(hidden = true, viewableMs = if (s.viewed) s.viewableMs else 0)

        ViewerAction.Show -> if (s.hidden) s.copy(hidden = false) else s

        // A paused video isn't playing, so its continuous playback count restarts.
        ViewerAction.Pause -> if (s.paused) s else s.copy(paused = true, viewableMs = restartVideo(s, group))

        ViewerAction.Resume -> if (s.paused) s.copy(paused = false) else s

        ViewerAction.MediaLoading -> if (s.buffering) s else s.copy(buffering = true, viewableMs = restartVideo(s, group))

        is ViewerAction.MediaReady -> {
            val d = action.durationMs
            s.copy(
                buffering = false,
                durationMs = if (d != null && d.isFinite() && d > 0) Math.round(d).toInt() else s.durationMs,
                displayed = s.displayed || !action.failed,
            )
        }

        ViewerAction.Close -> ViewerState.closed(CloseReason.USER, s.seq)
    }
}

/** Fill (0..1) of each progress bar in the current group. */
fun progressSegments(s: ViewerState, groups: List<ViewerGroup>): List<Double> {
    if (!s.open) return emptyList()
    val group = groups.getOrNull(s.groupIndex) ?: return emptyList()
    val current = if (s.durationMs > 0) (s.elapsedMs.toDouble() / s.durationMs).coerceIn(0.0, 1.0) else 0.0
    return group.stories.indices.map { i -> if (i < s.storyIndex) 1.0 else if (i == s.storyIndex) current else 0.0 }
}
