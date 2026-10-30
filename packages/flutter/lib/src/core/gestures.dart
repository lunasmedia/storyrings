/// Turns touches into taps, holds and swipes (spec/cases/gestures.json).
library;

const tapMaxMs = 250;
const _moveTolerance = 10;
const _swipeMinX = 50;
const _swipeMinY = 80;

enum SwipeDirection { left, right, down, up }

class GestureHandlers {
  const GestureHandlers(
      {required this.onTap, required this.onPress, required this.onRelease, required this.onSwipe, this.onDrag});

  /// Short tap; x is the horizontal position as a fraction (0..1) of the surface width.
  final void Function(double x) onTap;

  /// Finger is down: the viewer pauses at once (hold to pause).
  final void Function() onPress;

  /// Lifted without a tap or swipe (after a hold).
  final void Function() onRelease;
  final void Function(SwipeDirection direction) onSwipe;

  /// Live drag offset (e.g. swipe down to close).
  final void Function(double dx, double dy)? onDrag;
}

class GestureRecognizer {
  GestureRecognizer(this.handlers);
  final GestureHandlers handlers;
  ({double x, double y, int t})? _start;
  bool _moved = false;

  void down(double x, double y, int t) {
    _start = (x: x, y: y, t: t);
    _moved = false;
    handlers.onPress();
  }

  void move(double x, double y) {
    final start = _start;
    if (start == null) return;
    final dx = x - start.x;
    final dy = y - start.y;
    if (dx.abs() > _moveTolerance || dy.abs() > _moveTolerance) _moved = true;
    if (_moved) handlers.onDrag?.call(dx, dy);
  }

  void up(double x, double y, int t, double width) {
    final start = _start;
    _start = null;
    if (start == null) return;
    final dx = x - start.x;
    final dy = y - start.y;
    handlers.onDrag?.call(0, 0);
    if (_moved) {
      if (dx.abs() >= _swipeMinX && dx.abs() > dy.abs()) {
        handlers.onSwipe(dx < 0 ? SwipeDirection.left : SwipeDirection.right);
      } else if (dy.abs() >= _swipeMinY && dy.abs() > dx.abs()) {
        handlers.onSwipe(dy > 0 ? SwipeDirection.down : SwipeDirection.up);
      } else {
        handlers.onRelease();
      }
    } else if (t - start.t <= tapMaxMs) {
      handlers.onTap(width > 0 ? (x / width).clamp(0, 1).toDouble() : 0.5);
    } else {
      handlers.onRelease();
    }
  }

  void cancel() {
    if (_start == null) return;
    _start = null;
    handlers.onDrag?.call(0, 0);
    handlers.onRelease();
  }
}
