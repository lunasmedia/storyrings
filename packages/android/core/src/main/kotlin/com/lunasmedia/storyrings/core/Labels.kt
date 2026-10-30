package com.lunasmedia.storyrings.core

/** Accessible labels, worded exactly like the other SDKs (spec/constants.json → labels). */
object StoriesLabels {
    fun openGroup(title: String, count: Int, seen: Boolean) =
        "$title, $count ${if (count == 1) "story" else "stories"}${if (seen) ", viewed" else ""}"
    fun storyPosition(title: String, index: Int, total: Int) = "$title: story ${index + 1} of $total"
    fun viewer(title: String) = "Stories: $title"
    const val CLOSE = "Close stories"
    const val PAUSE = "Pause"
    const val PLAY = "Play"
    const val MUTE = "Mute"
    const val UNMUTE = "Unmute"
    const val PREVIOUS = "Previous story"
    const val NEXT = "Next story"
    const val SHARE = "Share story"
    const val LINK_COPIED = "Link copied"
    const val SHARE_FAILED = "Couldn’t share this story"
    const val BAR = "Stories"
    const val LOADING = "Loading stories"
}
