/**
 * Story circle appearance, version 1. Dependency-free so every SDK (web now,
 * iOS/Android/React Native in Phase 4) can share the same defaults and merge
 * rules. Import from "@stories/contracts/appearance".
 *
 * Resolution order: built-in defaults < app "story bar style" < group overrides.
 */

export const APPEARANCE_VERSION = 1 as const;

export const ringStyles = ['gradient', 'solid', 'none'] as const;
export const ringAnimations = ['none', 'rotate', 'pulse', 'shimmer'] as const;
export const animationSpeeds = ['slow', 'normal', 'fast'] as const;
export const badgeTypes = ['none', 'preset', 'text', 'emoji', 'countdown'] as const;
export const badgePresets = ['NEW', 'LIVE', 'SALE', 'HOT'] as const;
export const badgePositions = ['bottom', 'top-right'] as const;
export const titleWeights = [400, 600, 700] as const;

export interface RingAppearance {
  style: (typeof ringStyles)[number];
  /** 1 colour for solid, 2–3 for gradient (hex #rrggbb). */
  colors: string[];
  /** Gradient angle in degrees. */
  angle: number;
  /** Ring thickness, 2–6 px. */
  width: number;
  /** Space between ring and image, 0–6 px. */
  gap: number;
  /** "background" = the page background, "transparent", or a hex colour. */
  gapColor: string;
  /** Ring colour once every story in the group has been watched. */
  seenColor: string;
  animation: (typeof ringAnimations)[number];
  speed: (typeof animationSpeeds)[number];
  /** Stop animating once the group has been seen. */
  animateOnlyUnseen: boolean;
}

export interface BadgeAppearance {
  type: (typeof badgeTypes)[number];
  /** Preset label, custom text (≤ 6 chars) or a single emoji. Ignored for none/countdown. */
  text: string;
  background: string;
  color: string;
  position: (typeof badgePositions)[number];
}

export interface TitleAppearance {
  hidden: boolean;
  /** "inherit" (the page's text colour) or a hex colour. */
  color: string;
  weight: (typeof titleWeights)[number];
  maxLines: 1 | 2;
}

export interface Appearance {
  v: typeof APPEARANCE_VERSION;
  ring: RingAppearance;
  badge: BadgeAppearance;
  title: TitleAppearance;
}

/** Overrides: every field optional. Stored on apps (defaults) and groups. */
export interface AppearanceOverrides {
  v?: typeof APPEARANCE_VERSION;
  ring?: Partial<RingAppearance>;
  badge?: Partial<BadgeAppearance>;
  title?: Partial<TitleAppearance>;
}

export const DEFAULT_APPEARANCE: Appearance = {
  v: APPEARANCE_VERSION,
  ring: {
    style: 'gradient',
    colors: ['#feda75', '#d62976', '#962fbf'],
    angle: 45,
    width: 3,
    gap: 2,
    gapColor: 'background',
    seenColor: '#c7c7cc',
    animation: 'none',
    speed: 'normal',
    animateOnlyUnseen: true,
  },
  badge: { type: 'none', text: '', background: '#e8175d', color: '#ffffff', position: 'bottom' },
  title: { hidden: false, color: 'inherit', weight: 400, maxLines: 1 },
};

export const APPEARANCE_SECTIONS = ['ring', 'badge', 'title'] as const;
export type AppearanceSection = (typeof APPEARANCE_SECTIONS)[number];

/** Merges layers of overrides over the built-in defaults (later layers win). */
export function resolveAppearance(
  ...layers: (AppearanceOverrides | null | undefined)[]
): Appearance {
  const out: Appearance = {
    v: APPEARANCE_VERSION,
    ring: { ...DEFAULT_APPEARANCE.ring, colors: [...DEFAULT_APPEARANCE.ring.colors] },
    badge: { ...DEFAULT_APPEARANCE.badge },
    title: { ...DEFAULT_APPEARANCE.title },
  };
  for (const layer of layers) {
    if (!layer) continue;
    for (const section of APPEARANCE_SECTIONS) {
      const values = layer[section];
      if (!values) continue;
      for (const [key, value] of Object.entries(values)) {
        if (value !== undefined) (out[section] as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }
  return out;
}

/** Removes empty sections so stored overrides stay minimal; null when nothing is overridden. */
export function compactOverrides(
  o: AppearanceOverrides | null | undefined,
): AppearanceOverrides | null {
  if (!o) return null;
  const out: AppearanceOverrides = { v: APPEARANCE_VERSION };
  let any = false;
  for (const section of APPEARANCE_SECTIONS) {
    const values = Object.fromEntries(
      Object.entries(o[section] ?? {}).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(values).length) {
      (out as Record<string, unknown>)[section] = values;
      any = true;
    }
  }
  return any ? out : null;
}

/** Text shown in the badge, or null if there's no badge. Countdown needs `endsAt`. */
export function badgeLabel(
  badge: BadgeAppearance,
  endsAt: string | null | undefined,
  now = Date.now(),
): string | null {
  switch (badge.type) {
    case 'none':
      return null;
    case 'countdown':
      return endsAt ? formatCountdown(Date.parse(endsAt) - now) : null;
    default:
      return badge.text ? badge.text : null;
  }
}

/** "2d", "5h", "12m"; null once the time is up. */
export function formatCountdown(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Circle cover renditions as served to SDKs. */
export interface CoverDto {
  /** Square still image sized for the circle (also the poster for animated covers). */
  image: string;
  /** Looping muted MP4 for animated (GIF) covers. */
  video?: string;
  animated: boolean;
}

export interface CoverCropSettings {
  /** Centre of the crop, 0–1 of the source width/height. */
  x: number;
  y: number;
  /** 1 = the largest square that fits; 2 = half that size, etc. */
  zoom: number;
}

/** Pixel square for a crop, clamped inside the source. Shared by the server and the dashboard preview. */
export function cropRect(width: number, height: number, crop: CoverCropSettings) {
  const size = Math.max(1, Math.floor(Math.min(width, height) / Math.max(1, crop.zoom)));
  const left = Math.round(Math.min(Math.max(crop.x * width - size / 2, 0), width - size));
  const top = Math.round(Math.min(Math.max(crop.y * height - size / 2, 0), height - size));
  return { size, left, top };
}

/**
 * Shape and size of every item in the story bar. App-wide only (Settings);
 * groups can't override it.
 */
export interface BarLayout {
  /** Item width in px (ring included). */
  width: number;
  /** Item height in px (ring included). Taller than wide = portrait cards. */
  height: number;
  /** Corner rounding as % of the shorter side: 50 = circle/pill, 0 = square corners. */
  corner: number;
  /** Space between items in px. */
  gap: number;
}

export const BAR_LAYOUT_LIMITS = {
  width: [40, 160],
  height: [40, 240],
  corner: [0, 50],
  gap: [0, 48],
} as const satisfies Record<keyof BarLayout, readonly [number, number]>;

export const DEFAULT_BAR_LAYOUT: BarLayout = { width: 68, height: 68, corner: 50, gap: 14 };

/** Fills in and clamps a layout (unknown/invalid values fall back to the defaults). */
export function resolveBarLayout(input?: Partial<BarLayout> | null): BarLayout {
  const out = { ...DEFAULT_BAR_LAYOUT };
  for (const key of Object.keys(BAR_LAYOUT_LIMITS) as (keyof BarLayout)[]) {
    const v = input?.[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [min, max] = BAR_LAYOUT_LIMITS[key];
    out[key] = Math.round(Math.min(max, Math.max(min, v)));
  }
  return out;
}

/** Corner radius in px for a layout. */
export function barCornerRadius(l: BarLayout): number {
  return (Math.min(l.width, l.height) * l.corner) / 100;
}
