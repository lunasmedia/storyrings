/** Visual options for the story bar, shared by all SDKs. */
export interface StoriesTheme {
  /** Circle diameter in px (including the ring). */
  circleSize: number;
  /** Ring thickness in px. */
  ringWidth: number;
  /** Gap between ring and image in px. */
  ringGap: number;
  /** Colours of the unseen ring gradient (one colour = solid ring). */
  ringColors: string[];
  /** Ring colour for groups whose stories have all been seen. */
  seenRingColor: string;
  /** Group title. */
  titleColor: string;
  titleFont: string;
  titleSize: number;
  /** Hide titles under the circles. */
  hideTitles: boolean;
  /** Space around the bar (px). */
  barPadding: number;
  /** Space between circles (px). */
  gap: number;
}

export const defaultTheme: StoriesTheme = {
  circleSize: 68,
  ringWidth: 3,
  ringGap: 2,
  ringColors: ['#feda75', '#fa7e1e', '#d62976', '#962fbf'],
  seenRingColor: '#c7c7cc',
  titleColor: 'currentColor',
  titleFont: 'inherit',
  titleSize: 12,
  hideTitles: false,
  barPadding: 12,
  gap: 14,
};

const clamp = (n: unknown, min: number, max: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;

/** Merges partial options over defaults, clamping numbers to sensible ranges. */
export function resolveTheme(partial: Partial<StoriesTheme> = {}): StoriesTheme {
  const t = { ...defaultTheme, ...partial };
  return {
    ...t,
    circleSize: clamp(t.circleSize, 32, 160, defaultTheme.circleSize),
    ringWidth: clamp(t.ringWidth, 0, 10, defaultTheme.ringWidth),
    ringGap: clamp(t.ringGap, 0, 10, defaultTheme.ringGap),
    titleSize: clamp(t.titleSize, 8, 24, defaultTheme.titleSize),
    barPadding: clamp(t.barPadding, 0, 64, defaultTheme.barPadding),
    gap: clamp(t.gap, 0, 64, defaultTheme.gap),
    ringColors:
      Array.isArray(t.ringColors) && t.ringColors.length > 0
        ? t.ringColors
        : defaultTheme.ringColors,
    hideTitles: !!t.hideTitles,
  };
}
