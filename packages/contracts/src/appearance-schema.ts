import { z } from 'zod';
import {
  type Appearance,
  animationSpeeds,
  BAR_LAYOUT_LIMITS,
  badgePositions,
  badgePresets,
  badgeTypes,
  ringAnimations,
  ringStyles,
} from './appearance';
import { id } from './common';

export * from './appearance';

const hex = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour like #e8175d')
  .transform((v) => v.toLowerCase());

const graphemes = (s: string) =>
  [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;

/** Overrides: every field optional; the shape is validated strictly (unknown keys rejected). */
export const appearanceOverrides = z
  .object({
    v: z.literal(1).optional(),
    ring: z
      .object({
        style: z.enum(ringStyles),
        colors: z.array(hex).min(1).max(3),
        angle: z.number().int().min(0).max(360),
        width: z.number().int().min(2).max(6),
        gap: z.number().int().min(0).max(6),
        gapColor: z.union([z.literal('background'), z.literal('transparent'), hex]),
        seenColor: hex,
        animation: z.enum(ringAnimations),
        speed: z.enum(animationSpeeds),
        animateOnlyUnseen: z.boolean(),
      })
      .partial()
      .strict()
      .optional(),
    badge: z
      .object({
        type: z.enum(badgeTypes),
        text: z
          .string()
          .trim()
          .refine((s) => graphemes(s) <= 6, 'Badge text can be at most 6 characters'),
        background: hex,
        color: hex,
        position: z.enum(badgePositions),
      })
      .partial()
      .strict()
      .optional(),
    title: z
      .object({
        hidden: z.boolean(),
        color: z.union([z.literal('inherit'), hex]),
        weight: z.union([z.literal(400), z.literal(600), z.literal(700)]),
        maxLines: z.union([z.literal(1), z.literal(2)]),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();
export type AppearanceOverridesInput = z.input<typeof appearanceOverrides>;

const layoutNumber = (key: keyof typeof BAR_LAYOUT_LIMITS) =>
  z.number().int().min(BAR_LAYOUT_LIMITS[key][0]).max(BAR_LAYOUT_LIMITS[key][1]);

/** App-wide shape and size of the story bar items (Settings only). */
export const barLayoutSchema = z
  .object({
    width: layoutNumber('width'),
    height: layoutNumber('height'),
    corner: layoutNumber('corner'),
    gap: layoutNumber('gap'),
  })
  .strict();

const EMOJI = /^\p{Extended_Pictographic}/u;

/** Rules that depend on several fields; checked on the resolved appearance. */
export function appearanceProblems(a: Appearance): { path: string; message: string }[] {
  const problems: { path: string; message: string }[] = [];
  if (a.ring.style === 'gradient' && (a.ring.colors.length < 2 || a.ring.colors.length > 3)) {
    problems.push({ path: 'ring.colors', message: 'A gradient needs 2 or 3 colours' });
  }
  if (a.ring.style === 'solid' && a.ring.colors.length < 1) {
    problems.push({ path: 'ring.colors', message: 'Pick a ring colour' });
  }
  const { type, text } = a.badge;
  if (type === 'preset' && !(badgePresets as readonly string[]).includes(text)) {
    problems.push({ path: 'badge.text', message: `Choose one of ${badgePresets.join(', ')}` });
  }
  if (type === 'text' && !text)
    problems.push({ path: 'badge.text', message: 'Enter the badge text' });
  if (type === 'emoji' && (graphemes(text) !== 1 || !EMOJI.test(text))) {
    problems.push({ path: 'badge.text', message: 'Enter a single emoji' });
  }
  return problems;
}

/** Cover choice: the original upload plus how to crop it (centre x/y in 0–1, zoom ≥ 1). */
export const coverInput = z.object({
  mediaId: id,
  crop: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      zoom: z.number().min(1).max(5),
    })
    .default({ x: 0.5, y: 0.5, zoom: 1 }),
  /** Animated covers: which moment to use as the still/poster frame. */
  posterMs: z.number().int().min(0).max(10_000).default(0),
});
export type CoverInput = z.input<typeof coverInput>;
