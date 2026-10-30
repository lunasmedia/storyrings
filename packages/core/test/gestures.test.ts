import { describe, expect, it, vi } from 'vitest';
import { GestureRecognizer } from '../src/gestures';

function setup() {
  const h = {
    onTap: vi.fn(),
    onPress: vi.fn(),
    onRelease: vi.fn(),
    onSwipe: vi.fn(),
    onDrag: vi.fn(),
  };
  return { h, g: new GestureRecognizer(h) };
}

describe('GestureRecognizer', () => {
  it('reports a quick tap with its horizontal position', () => {
    const { h, g } = setup();
    g.down(80, 300, 0);
    expect(h.onPress).toHaveBeenCalledOnce();
    g.up(82, 302, 120, 400);
    expect(h.onTap).toHaveBeenCalledWith(82 / 400);
    expect(h.onRelease).not.toHaveBeenCalled();
  });

  it('treats a long press as hold-to-pause (release, no tap)', () => {
    const { h, g } = setup();
    g.down(200, 300, 0);
    g.up(200, 300, 900, 400);
    expect(h.onTap).not.toHaveBeenCalled();
    expect(h.onRelease).toHaveBeenCalledOnce();
  });

  it.each([
    [-120, 10, 'left'],
    [120, -10, 'right'],
    [5, 150, 'down'],
    [5, -150, 'up'],
  ])('detects a swipe of (%i, %i) as %s', (dx, dy, dir) => {
    const { h, g } = setup();
    g.down(200, 300, 0);
    g.move(200 + dx / 2, 300 + dy / 2);
    g.move(200 + dx, 300 + dy);
    g.up(200 + dx, 300 + dy, 200, 400);
    expect(h.onSwipe).toHaveBeenCalledWith(dir);
    expect(h.onTap).not.toHaveBeenCalled();
  });

  it('reports drag offsets for swipe-down feedback and resets them on release', () => {
    const { h, g } = setup();
    g.down(0, 0, 0);
    g.move(0, 40);
    expect(h.onDrag).toHaveBeenLastCalledWith(0, 40);
    g.up(0, 40, 100, 400);
    expect(h.onDrag).toHaveBeenLastCalledWith(0, 0);
    // Too short to be a swipe: just releases the hold.
    expect(h.onSwipe).not.toHaveBeenCalled();
    expect(h.onRelease).toHaveBeenCalledOnce();
  });

  it('ignores small jitter when deciding between tap and drag', () => {
    const { h, g } = setup();
    g.down(100, 100, 0);
    g.move(104, 97);
    g.up(104, 97, 100, 400);
    expect(h.onTap).toHaveBeenCalled();
    expect(h.onDrag).not.toHaveBeenCalledWith(4, -3);
  });

  it('releases on cancel and ignores stray events', () => {
    const { h, g } = setup();
    g.up(0, 0, 0, 100);
    g.move(10, 10);
    expect(h.onTap).not.toHaveBeenCalled();
    g.down(0, 0, 0);
    g.cancel();
    expect(h.onRelease).toHaveBeenCalledOnce();
  });
});
