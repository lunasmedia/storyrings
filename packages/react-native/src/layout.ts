/**
 * Pure sizing and styling decisions for the bar, kept free of react-native
 * imports so they can be unit-tested.
 */
import {
  type Appearance,
  type BarLayout,
  badgeLabel,
  barCornerRadius,
  DEFAULT_APPEARANCE,
  resolveAppearance,
} from '@stories/contracts/appearance';
import type { StoriesTheme } from '@stories/core';

export interface BarMetrics {
  /** Item size, ring included. */
  width: number;
  height: number;
  radius: number;
  gap: number;
  padding: number;
  titleSize: number;
}

/** The dashboard's shape and size win over the code theme's circle size and spacing. */
export function barMetrics(theme: StoriesTheme, layout?: BarLayout): BarMetrics {
  const width = layout?.width ?? theme.circleSize;
  const height = layout?.height ?? theme.circleSize;
  return {
    width,
    height,
    radius: layout ? barCornerRadius(layout) : theme.circleSize / 2,
    gap: layout?.gap ?? theme.gap,
    padding: theme.barPadding,
    titleSize: theme.titleSize,
  };
}

/** Appearance used when the server sends none (older servers): built from the code theme. */
export function themeAppearance(theme: StoriesTheme): Appearance {
  return resolveAppearance({
    ring: {
      style: theme.ringColors.length > 1 ? 'gradient' : 'solid',
      colors: theme.ringColors.slice(0, 3),
      width: theme.ringWidth,
      gap: theme.ringGap,
      seenColor: theme.seenRingColor,
    },
    title: {
      hidden: theme.hideTitles,
      color: theme.titleColor === 'currentColor' ? 'inherit' : theme.titleColor,
    },
  });
}

export const SPEED_MS = { slow: 4000, normal: 2400, fast: 1200 } as const;

/**
 * CSS linear-gradient with every stop's position written out, evenly spaced.
 * Android logs a warning for each stop without one.
 */
export function linearGradient(angle: number, colors: readonly string[]): string {
  const last = Math.max(1, colors.length - 1);
  const stops = colors.map((c, i) => `${c} ${Math.round((i / last) * 100)}%`);
  return `linear-gradient(${angle}deg, ${stops.join(', ')})`;
}

export interface RingPaint {
  /** Solid colour (also the fallback where gradients aren't supported). */
  color: string;
  /** CSS linear-gradient for React Native's background image, when it's a gradient. */
  gradient: string | null;
  width: number;
}

export function ringPaint(a: Appearance, seen: boolean): RingPaint {
  const { ring } = a;
  if (ring.style === 'none') return { color: 'transparent', gradient: null, width: 0 };
  if (seen) return { color: ring.seenColor, gradient: null, width: ring.width };
  const colors = ring.colors.length ? ring.colors : DEFAULT_APPEARANCE.ring.colors;
  const gradient =
    ring.style === 'gradient' && colors.length > 1 ? linearGradient(ring.angle, colors) : null;
  return { color: colors[0]!, gradient, width: ring.width };
}

/** Which ring animation to run, if any. */
export function ringAnimation(
  a: Appearance,
  seen: boolean,
  reducedMotion: boolean,
): Exclude<Appearance['ring']['animation'], 'none'> | null {
  const { ring } = a;
  if (ring.animation === 'none' || ring.style === 'none' || reducedMotion) return null;
  if (seen && ring.animateOnlyUnseen) return null;
  return ring.animation;
}

/** Colour between ring and image. "background" is the screen behind the bar. */
export function gapColor(a: Appearance, background: string): string {
  return a.ring.gapColor === 'background' ? background : a.ring.gapColor;
}

/** Title colour. "inherit" means the app's text colour. */
export function titleColor(a: Appearance, textColor: string): string {
  return a.title.color === 'inherit' ? textColor : a.title.color;
}

/** Badge text for screen readers, e.g. ", NEW" or ", ends in 5h". */
export function badgeSpeech(a: Appearance, endsAt: string | null | undefined, now?: number) {
  const text = badgeLabel(a.badge, endsAt, now);
  if (!text) return '';
  return a.badge.type === 'countdown' ? `, ends in ${text}` : `, ${text}`;
}

/** Indexes of items at least half visible in a horizontal list scrolled to `offset`. */
export function visibleItems(
  count: number,
  m: Pick<BarMetrics, 'width' | 'gap' | 'padding'>,
  offset: number,
  viewport: number,
): number[] {
  const out: number[] = [];
  // Items are wider than the ring by the title allowance (see Circle).
  const item = m.width + 12;
  for (let i = 0; i < count; i++) {
    const start = m.padding + i * (item + m.gap) - offset;
    const visible = Math.min(start + item, viewport) - Math.max(start, 0);
    if (visible >= item / 2) out.push(i);
  }
  return out;
}
