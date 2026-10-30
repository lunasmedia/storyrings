export type SwipeDirection = 'left' | 'right' | 'down' | 'up';

export interface GestureHandlers {
  /** Short tap; x is the horizontal position as a fraction (0..1) of the surface width. */
  onTap(x: number): void;
  /** Finger/mouse is down. Viewers pause immediately (hold to pause). */
  onPress(): void;
  /** Released without a tap or swipe (i.e. after a hold). */
  onRelease(): void;
  onSwipe(direction: SwipeDirection): void;
  /** Live drag offset for visual feedback (e.g. swipe down to close). */
  onDrag?(dx: number, dy: number): void;
}

export const TAP_MAX_MS = 250;
const MOVE_TOLERANCE = 10;
const SWIPE_MIN_X = 50;
const SWIPE_MIN_Y = 80;

interface Point {
  x: number;
  y: number;
  t: number;
}

/**
 * Turns pointer down/move/up into taps, holds and swipes. Coordinates are
 * passed in explicitly so it can be unit-tested without a DOM.
 */
export class GestureRecognizer {
  private start: Point | null = null;
  private moved = false;

  constructor(private readonly handlers: GestureHandlers) {}

  down(x: number, y: number, t: number): void {
    this.start = { x, y, t };
    this.moved = false;
    this.handlers.onPress();
  }

  move(x: number, y: number): void {
    if (!this.start) return;
    const dx = x - this.start.x;
    const dy = y - this.start.y;
    if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) this.moved = true;
    if (this.moved) this.handlers.onDrag?.(dx, dy);
  }

  up(x: number, y: number, t: number, width: number): void {
    const start = this.start;
    this.start = null;
    if (!start) return;
    const dx = x - start.x;
    const dy = y - start.y;
    this.handlers.onDrag?.(0, 0);

    if (this.moved) {
      if (Math.abs(dx) >= SWIPE_MIN_X && Math.abs(dx) > Math.abs(dy)) {
        this.handlers.onSwipe(dx < 0 ? 'left' : 'right');
      } else if (Math.abs(dy) >= SWIPE_MIN_Y && Math.abs(dy) > Math.abs(dx)) {
        this.handlers.onSwipe(dy > 0 ? 'down' : 'up');
      } else {
        this.handlers.onRelease();
      }
    } else if (t - start.t <= TAP_MAX_MS) {
      this.handlers.onTap(width > 0 ? Math.min(1, Math.max(0, x / width)) : 0.5);
    } else {
      this.handlers.onRelease();
    }
  }

  cancel(): void {
    if (!this.start) return;
    this.start = null;
    this.handlers.onDrag?.(0, 0);
    this.handlers.onRelease();
  }
}
