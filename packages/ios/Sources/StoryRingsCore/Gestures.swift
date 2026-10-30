// Turns touches into taps, holds and swipes (spec/cases/gestures.json).

public enum Gestures {
    public static let tapMaxMs = 250
    static let moveTolerance = 10.0
    static let swipeMinX = 50.0
    static let swipeMinY = 80.0
}

public enum SwipeDirection: String, Sendable {
    case left, right, down, up
}

public struct GestureHandlers {
    /// Short tap; x is the horizontal position as a fraction (0...1) of the surface width.
    public var onTap: (Double) -> Void
    /// Finger is down: the viewer pauses at once (hold to pause).
    public var onPress: () -> Void
    /// Lifted without a tap or swipe (after a hold).
    public var onRelease: () -> Void
    public var onSwipe: (SwipeDirection) -> Void
    /// Live drag offset (e.g. swipe down to close).
    public var onDrag: ((Double, Double) -> Void)?

    public init(
        onTap: @escaping (Double) -> Void,
        onPress: @escaping () -> Void,
        onRelease: @escaping () -> Void,
        onSwipe: @escaping (SwipeDirection) -> Void,
        onDrag: ((Double, Double) -> Void)? = nil
    ) {
        self.onTap = onTap
        self.onPress = onPress
        self.onRelease = onRelease
        self.onSwipe = onSwipe
        self.onDrag = onDrag
    }
}

public final class GestureRecognizer {
    public let handlers: GestureHandlers
    private var start: (x: Double, y: Double, t: Int)?
    private var moved = false

    public init(_ handlers: GestureHandlers) {
        self.handlers = handlers
    }

    public func down(_ x: Double, _ y: Double, _ t: Int) {
        start = (x, y, t)
        moved = false
        handlers.onPress()
    }

    public func move(_ x: Double, _ y: Double) {
        guard let start else { return }
        let dx = x - start.x
        let dy = y - start.y
        if abs(dx) > Gestures.moveTolerance || abs(dy) > Gestures.moveTolerance { moved = true }
        if moved { handlers.onDrag?(dx, dy) }
    }

    public func up(_ x: Double, _ y: Double, _ t: Int, width: Double) {
        guard let start else { return }
        self.start = nil
        let dx = x - start.x
        let dy = y - start.y
        handlers.onDrag?(0, 0)
        if moved {
            if abs(dx) >= Gestures.swipeMinX && abs(dx) > abs(dy) {
                handlers.onSwipe(dx < 0 ? .left : .right)
            } else if abs(dy) >= Gestures.swipeMinY && abs(dy) > abs(dx) {
                handlers.onSwipe(dy > 0 ? .down : .up)
            } else {
                handlers.onRelease()
            }
        } else if t - start.t <= Gestures.tapMaxMs {
            handlers.onTap(width > 0 ? min(1, max(0, x / width)) : 0.5)
        } else {
            handlers.onRelease()
        }
    }

    public func cancel() {
        guard start != nil else { return }
        start = nil
        handlers.onDrag?(0, 0)
        handlers.onRelease()
    }
}
