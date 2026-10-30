package com.stories.core

// Analytics events derived from the viewer (a port of `@stories/core` viewer events;
// definitions in docs/metrics.md, pinned by spec/cases/viewer.json).

/** A story event: about a group (and story), in the bar or the viewer. `bar`: the story bar's key, null = the main bar. */
data class StoryEvent(val type: String, val groupId: String, val storyId: String? = null, val bar: String? = null) {
    fun withBar(bar: String?) = copy(bar = bar)

    fun toJson(): Map<String, Any?> = linkedMapOf<String, Any?>("type" to type, "groupId" to groupId).apply {
        if (storyId != null) put("storyId", storyId)
        if (bar != null) put("bar", bar)
    }
}

/**
 * Events from a change of viewer state:
 * - group_complete when moving forward past a group's last story after it was shown
 * - group_open when the viewer opens on a group or moves to another one
 * - story_view once a story meets the viewability rule
 */
fun transitionEvents(prev: ViewerState, next: ViewerState, groups: List<ViewerGroup>): List<StoryEvent> {
    val events = mutableListOf<StoryEvent>()
    val prevGroup = groups.getOrNull(prev.groupIndex)
    if (prev.open && prevGroup != null) {
        val wasLast = prev.storyIndex == prevGroup.stories.size - 1
        val movedForward = if (next.open) next.groupIndex > prev.groupIndex else next.closeReason == CloseReason.COMPLETED
        if (wasLast && movedForward && prev.displayed) events += StoryEvent("group_complete", prevGroup.id)
    }
    if (!next.open) return events
    val group = groups.getOrNull(next.groupIndex) ?: return events
    val story = group.stories.getOrNull(next.storyIndex) ?: return events
    val sameStory = prev.open && prev.seq == next.seq
    if (!sameStory && (!prev.open || prev.groupIndex != next.groupIndex)) events += StoryEvent("group_open", group.id)
    if (next.viewed && !(sameStory && prev.viewed)) events += StoryEvent("story_view", group.id, story.id)
    return events
}

/**
 * Events from how the person moves (a state change alone can't tell a tap from a story ending).
 * Call with the state before the action.
 * tap_forward (Next by the person), tap_back (Prev), group_skip (NextGroup), exit (Close).
 */
fun actionEvents(state: ViewerState, action: ViewerAction, groups: List<ViewerGroup>): List<StoryEvent> {
    if (!state.open) return emptyList()
    val group = groups.getOrNull(state.groupIndex) ?: return emptyList()
    val story = group.stories.getOrNull(state.storyIndex) ?: return emptyList()
    val type = when (action) {
        is ViewerAction.Next -> if (action.auto) null else "tap_forward"
        ViewerAction.Prev -> "tap_back"
        ViewerAction.NextGroup -> "group_skip"
        ViewerAction.Close -> "exit"
        else -> null
    } ?: return emptyList()
    return listOf(StoryEvent(type, group.id, story.id))
}
