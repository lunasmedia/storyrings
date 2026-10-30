import { resolveAppearance } from '@stories/contracts/appearance';
import { resolveTheme } from '@stories/core';
import { describe, expect, it } from 'vitest';
import {
  badgeSpeech,
  barMetrics,
  gapColor,
  linearGradient,
  ringAnimation,
  ringPaint,
  themeAppearance,
  titleColor,
  visibleItems,
} from '../src/layout';

const theme = resolveTheme({ circleSize: 72, gap: 10, barPadding: 12 });

describe('barMetrics', () => {
  it('uses the code theme when the dashboard sets no shape', () => {
    expect(barMetrics(theme)).toMatchObject({ width: 72, height: 72, radius: 36, gap: 10 });
  });

  it('lets the dashboard shape and size win over the code theme', () => {
    const m = barMetrics(theme, { width: 81, height: 116, corner: 16, gap: 2 });
    expect(m).toMatchObject({ width: 81, height: 116, gap: 2, padding: 12 });
    expect(m.radius).toBeCloseTo(12.96);
  });
});

describe('ring', () => {
  const gradient = resolveAppearance({
    ring: { style: 'gradient', colors: ['#ff0000', '#0000ff'], angle: 90, width: 4 },
  });

  it('paints gradients as CSS for React Native, with a solid fallback colour', () => {
    expect(ringPaint(gradient, false)).toEqual({
      color: '#ff0000',
      gradient: 'linear-gradient(90deg, #ff0000 0%, #0000ff 100%)',
      width: 4,
    });
  });

  it('uses the seen colour once watched, and nothing for "no ring"', () => {
    expect(ringPaint(gradient, true)).toEqual({ color: '#c7c7cc', gradient: null, width: 4 });
    expect(ringPaint(resolveAppearance({ ring: { style: 'none' } }), false).width).toBe(0);
  });

  it('animates only when allowed', () => {
    const rotate = resolveAppearance({ ring: { animation: 'rotate', animateOnlyUnseen: true } });
    expect(ringAnimation(rotate, false, false)).toBe('rotate');
    expect(ringAnimation(rotate, true, false)).toBeNull(); // watched
    expect(ringAnimation(rotate, false, true)).toBeNull(); // reduce motion
    const always = resolveAppearance({ ring: { animation: 'pulse', animateOnlyUnseen: false } });
    expect(ringAnimation(always, true, false)).toBe('pulse');
  });

  it('resolves "background" and "inherit" against the app', () => {
    const a = resolveAppearance({});
    expect(gapColor(a, '#000000')).toBe('#000000');
    expect(titleColor(a, '#ffffff')).toBe('#ffffff');
    const custom = resolveAppearance({
      ring: { gapColor: '#123456' },
      title: { color: '#abcdef' },
    });
    expect(gapColor(custom, '#000000')).toBe('#123456');
    expect(titleColor(custom, '#ffffff')).toBe('#abcdef');
  });

  it('builds an appearance from the code theme for older servers', () => {
    const a = themeAppearance(resolveTheme({ ringColors: ['#111111'], hideTitles: true }));
    expect(a.ring.style).toBe('solid');
    expect(a.title.hidden).toBe(true);
  });
});

describe('linearGradient', () => {
  it('writes every stop position, which Android needs', () => {
    expect(linearGradient(45, ['#111111', '#222222', '#333333'])).toBe(
      'linear-gradient(45deg, #111111 0%, #222222 50%, #333333 100%)',
    );
    expect(linearGradient(0, ['#111111'])).toBe('linear-gradient(0deg, #111111 0%)');
  });
});

describe('badgeSpeech', () => {
  it('reads badges and countdowns for screen readers', () => {
    const live = resolveAppearance({ badge: { type: 'preset', text: 'LIVE' } });
    expect(badgeSpeech(live, null)).toBe(', LIVE');
    const countdown = resolveAppearance({ badge: { type: 'countdown' } });
    expect(badgeSpeech(countdown, '2026-01-01T05:00:00Z', Date.parse('2026-01-01T00:00:00Z'))).toBe(
      ', ends in 5h',
    );
    expect(badgeSpeech(resolveAppearance({}), null)).toBe('');
  });
});

describe('visibleItems', () => {
  // Items are 60 + 12 wide with a 10 gap, after 12 padding: 12–84, 94–166, 176–248…
  const m = { width: 60, gap: 10, padding: 12 };

  it('counts items at least half on screen', () => {
    expect(visibleItems(5, m, 0, 200)).toEqual([0, 1]); // item 2 shows 24 of 72
    expect(visibleItems(5, m, 0, 215)).toEqual([0, 1, 2]);
  });

  it('follows the scroll position', () => {
    expect(visibleItems(5, m, 100, 200)).toEqual([1, 2, 3]);
  });
});
