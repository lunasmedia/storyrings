package com.stories.core

import kotlin.math.abs

// Turns touches into taps, holds and swipes (spec/cases/gestures.json).

object Gestures {
    const val TAP_MAX_MS = 250
    internal const val MOVE_TOLERANCE = 10.0
    internal const val SWIPE_MIN_X = 50.0
    internal const val SWIPE_MIN_Y = 80.0
}

enum class SwipeDirection(val json: String) { LEFT("left"), RIGHT("right"), DOWN("down"), UP("up") }

class GestureHandlers(
    /** Short tap; x is the horizontal position as a fraction (0..1) of the surface width. */
    val onTap: (Double) -> Unit,
    /** Finger is down: the viewer pauses at once (hold to pause). */
    val onPress: () -> Unit,
    /** Lifted without a tap or swipe (after a hold). */
    val onRelease: () -> Unit,
    val onSwipe: (SwipeDirection) -> Unit,
    /** Live drag offset (e.g. swipe down to close). */
    val onDrag: ((Double, Double) -> Unit)? = null,
)

class GestureRecognizer(private val handlers: GestureHandlers) {
    private var startX = 0.0
    private var startY = 0.0
    private var startT = 0L
    private var down = false
    private var moved = false

    fun down(x: Double, y: Double, t: Long) {
        startX = x
        startY = y
        startT = t
        down = true
        moved = false
        handlers.onPress()
    }

    fun move(x: Double, y: Double) {
        if (!down) return
        val dx = x - startX
        val dy = y - startY
        if (abs(dx) > Gestures.MOVE_TOLERANCE || abs(dy) > Gestures.MOVE_TOLERANCE) moved = true
        if (moved) handlers.onDrag?.invoke(dx, dy)
    }

    fun up(x: Double, y: Double, t: Long, width: Double) {
        if (!down) return
        down = false
        val dx = x - startX
        val dy = y - startY
        handlers.onDrag?.invoke(0.0, 0.0)
        when {
            moved -> when {
                abs(dx) >= Gestures.SWIPE_MIN_X && abs(dx) > abs(dy) ->
                    handlers.onSwipe(if (dx < 0) SwipeDirection.LEFT else SwipeDirection.RIGHT)
                abs(dy) >= Gestures.SWIPE_MIN_Y && abs(dy) > abs(dx) ->
                    handlers.onSwipe(if (dy > 0) SwipeDirection.DOWN else SwipeDirection.UP)
                else -> handlers.onRelease()
            }
            t - startT <= Gestures.TAP_MAX_MS -> handlers.onTap(if (width > 0) (x / width).coerceIn(0.0, 1.0) else 0.5)
            else -> handlers.onRelease()
        }
    }

    fun cancel() {
        if (!down) return
        down = false
        handlers.onDrag?.invoke(0.0, 0.0)
        handlers.onRelease()
    }
}
