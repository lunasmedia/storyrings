package com.lunasmedia.storyrings.core

// The Energized style's order (spec/cases/energized.json).

/** How long each group's story previews in its card before the next card takes a turn. */
const val ENERGIZED_PREVIEW_MS = 7000

/** The card previewing now: which group, its story (always the first), and which turn this is. */
data class EnergizedPreview(
    val groupIndex: Int,
    val storyIndex: Int,
    val storyId: String,
    /** Goes up every time a preview starts (even the same group again): restart the media. */
    val turn: Int,
) {
    val json: Map<String, Any?>
        get() = mapOf("groupIndex" to groupIndex, "storyIndex" to storyIndex, "storyId" to storyId, "turn" to turn)
}

/**
 * One group at a time shows its first story (only ever the first, seen or not) inside its card for
 * [ENERGIZED_PREVIEW_MS], then the next group does, through every group in bar order and back to the
 * first; the UI scrolls each card into view for its turn. It starts from the first fully visible
 * group. When the bar is scrolled so that the card previewing is no longer fully visible, it
 * starts again from the first visible one. The UI reports which cards are fully on screen,
 * passes time with [tick] and draws [current].
 *
 * @param groups each group's story ids, in bar order.
 */
class EnergizedCycle(private var groups: List<List<String>>) {
    /** Indexes of the groups with stories, in bar order: the turns go through these. */
    private var order: List<Int> = withStories(groups.indices)
    /** Indexes of the groups with stories whose cards are fully on screen. */
    private var visible: List<Int> = emptyList()
    /** Where in [order] the preview is, or -1 when nothing previews. */
    private var position = -1
    private var elapsed = 0
    private var turns = 0

    /** New feed: starts again from the first visible group that still has stories. */
    fun setGroups(groups: List<List<String>>) {
        this.groups = groups
        order = withStories(groups.indices)
        visible = withStories(visible)
        restart()
    }

    /**
     * Indexes of the groups whose cards are fully on screen, in any order. Groups without
     * stories are skipped. While the card previewing is among them nothing changes (the bar
     * scrolled to it, or only a little); otherwise it starts again from the first.
     */
    fun setVisible(indexes: Collection<Int>) {
        visible = withStories(indexes)
        val index = order.getOrNull(position)
        if (index != null && index in visible) return
        restart()
    }

    /** Time passing (only while previews may play: on screen, nothing covering the bar). */
    fun tick(ms: Int) {
        if (position < 0 || ms <= 0) return
        elapsed += ms
        while (elapsed >= ENERGIZED_PREVIEW_MS) {
            elapsed -= ENERGIZED_PREVIEW_MS
            position = (position + 1) % order.size
            turns++
        }
    }

    /** Milliseconds left of the current preview (for scheduling the next tick). */
    val remainingMs: Int get() = if (position < 0) 0 else ENERGIZED_PREVIEW_MS - elapsed

    val current: EnergizedPreview?
        get() {
            val groupIndex = order.getOrNull(position) ?: return null
            val storyId = groups[groupIndex].firstOrNull() ?: return null
            return EnergizedPreview(groupIndex, 0, storyId, turns)
        }

    /** From the first visible group, or nothing when none is. */
    private fun restart() {
        elapsed = 0
        position = visible.firstOrNull()?.let { order.indexOf(it) } ?: -1
        if (position >= 0) turns++
    }

    private fun withStories(indexes: Iterable<Int>): List<Int> =
        indexes.toSet().filter { it in groups.indices && groups[it].isNotEmpty() }.sorted()
}
