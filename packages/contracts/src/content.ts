import { z } from 'zod';
import {
  type Appearance,
  type AppearanceOverrides,
  appearanceOverrides,
  type CoverDto,
  coverInput,
} from './appearance-schema';
import { id } from './common';
import { CTA_STYLES, type CtaStyle } from './cta';
import { type StoryDesign, storyDesignInput } from './design';
import type { StoryFill, StoryFit, StoryType } from './sdk-types';
import type { TagCondition } from './tags';
import { tagFilterInput } from './targeting';

/** A group's on/off switch: "published" = Live in the SDK, "draft" = Off. */
export const groupStatuses = ['draft', 'published'] as const;
export type GroupStatus = (typeof groupStatuses)[number];

/** Each story's own status. Kept when its group is turned off and on again. */
export const storyStatuses = ['draft', 'published'] as const;
export type StoryStatus = (typeof storyStatuses)[number];

export const storyTypes = ['image', 'video'] as const satisfies readonly StoryType[];
export type { StoryFill, StoryFit, StoryType } from './sdk-types';

export const IMAGE_DURATION_DEFAULT_MS = 5000;
export const IMAGE_DURATION_MIN_MS = 1000;
export const IMAGE_DURATION_MAX_MS = 30000;

export const GROUP_TITLE_MAX = 40;
const title = z.string().trim().min(1).max(GROUP_TITLE_MAX);
/** ISO 8601 timestamp with offset, e.g. 2026-11-01T09:00:00.000Z; null clears it. */
const scheduleDate = z.iso.datetime({ offset: true }).nullable();

export const createGroupInput = z.object({
  title,
  coverMediaId: id.nullable().optional(),
  startsAt: scheduleDate.optional(),
  endsAt: scheduleDate.optional(),
  /** Cover with crop/poster settings (preferred over coverMediaId). */
  cover: coverInput.nullable().optional(),
  /** Circle appearance overrides; null = inherit everything from the app. */
  appearance: appearanceOverrides.nullable().optional(),
  /** Story bars to show it in. Omitted = the app's main bar. */
  barIds: z.array(id).max(50).optional(),
  /** Tag conditions people must all pass to see it. Omitted or empty = no filter. */
  tagFilter: tagFilterInput.optional(),
});
export type CreateGroupInput = z.input<typeof createGroupInput>;

export const updateGroupInput = z
  .object({
    title,
    coverMediaId: id.nullable(),
    startsAt: scheduleDate,
    endsAt: scheduleDate,
    cover: coverInput.nullable(),
    appearance: appearanceOverrides.nullable(),
    /** Every story bar it appears in (replaces the current list; empty = shown nowhere). */
    barIds: z.array(id).max(50),
    /** With `appearance`: the one story bar to set it for. Omitted = every bar it's in. */
    appearanceBarId: id,
    /** Tag conditions people must all pass to see it (replaces them; empty = no filter). */
    tagFilter: tagFilterInput,
  })
  .partial();
export type UpdateGroupInput = z.input<typeof updateGroupInput>;

/** CTA url is checked against the app's allowed schemes on the server. */
export const ctaInput = z.object({
  label: z.string().trim().min(1).max(30),
  url: z.string().trim().min(1).max(2048),
  /** Defaults to "pill". */
  style: z.enum(CTA_STYLES).optional(),
});

export const STORY_TITLE_MAX = GROUP_TITLE_MAX;

export const storyFits = ['fill', 'fit'] as const;
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour like #ff3366');
export const storyFillInput = z.object({
  top: hex,
  bottom: hex,
  /** Taken from the image (the studio takes them again when the image changes), not chosen. */
  auto: z.boolean().optional(),
});

export const createStoryInput = z.object({
  mediaId: id,
  /**
   * The story's own name. Omitted, null or empty = use the group's title (and
   * keep following it if the group is renamed).
   */
  title: z
    .string()
    .trim()
    .max(STORY_TITLE_MAX)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null)),
  /** Images only; videos use the media duration. */
  durationMs: z.number().int().min(IMAGE_DURATION_MIN_MS).max(IMAGE_DURATION_MAX_MS).optional(),
  /** Screen-reader description. Strongly recommended for images; the dashboard flags it when missing. */
  altText: z.string().trim().max(300).optional(),
  cta: ctaInput.nullable().optional(),
  /** Defaults to "published". */
  status: z.enum(storyStatuses).optional(),
  /**
   * Designed in the studio: `mediaId` is then the rendered image, or for a design over a video
   * the video itself (its background). Null = a plain photo or video.
   */
  design: storyDesignInput.nullable().optional(),
  /**
   * A design over a video: its text, shapes and stickers as a transparent 1080 × 1920 image of
   * this app, drawn over the video. Null = nothing to draw (interactive stickers only).
   */
  overlayMediaId: id.nullable().optional(),
  /** "fill" covers the screen (edges may be cropped), "fit" shows all of it. Defaults to "fill" ("fit" for designs). */
  fit: z.enum(storyFits).optional(),
  /** Colours for the gaps around a "fit" story, top to bottom (taken from the image). Null = black. */
  fill: storyFillInput.nullable().optional(),
});
export type CreateStoryInput = z.input<typeof createStoryInput>;

export const updateStoryInput = createStoryInput.partial();
export type UpdateStoryInput = z.input<typeof updateStoryInput>;

export interface MediaRefDto {
  id: string;
  url: string;
  /** GIFs: a full-frame MP4 the dashboard can scrub to pick a poster frame. */
  previewUrl?: string | null;
  mime: string;
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export interface StoryDto {
  id: string;
  groupId: string;
  position: number;
  status: StoryStatus;
  /** The story's own name, or null when it uses the group's title. */
  title: string | null;
  type: StoryType;
  durationMs: number;
  altText: string;
  cta: { label: string; url: string; style: CtaStyle } | null;
  media: MediaRefDto;
  /** The studio design the image was rendered from, if it was designed there. */
  design: StoryDesign | null;
  /** A video designed in the studio: its text and stickers as a transparent image over it. */
  overlay?: string | null;
  fit: StoryFit;
  fill: (StoryFill & { auto?: boolean }) | null;
  createdAt: string;
  updatedAt: string;
}

export interface GroupDto {
  id: string;
  appId: string;
  title: string;
  position: number;
  status: GroupStatus;
  publishedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  /** The original cover upload (kept so the crop can be adjusted later). */
  cover: MediaRefDto | null;
  /** How the original is cropped for the circle. */
  coverCrop: { crop: { x: number; y: number; zoom: number }; posterMs: number } | null;
  /** Circle-sized files generated from the cover (what the SDK shows). */
  coverRender: CoverDto | null;
  /**
   * The style it was created or last edited with for all its bars; it applies while the group
   * is in none. Each bar's copy is in `barAppearance`.
   */
  appearance: AppearanceOverrides | null;
  /** App defaults merged with `appearance` (the feed resolves per bar instead). */
  resolvedAppearance: Appearance;
  /** Story bars it appears in. */
  barIds: string[];
  /**
   * Its own style in each of those bars (null = exactly that bar's style). A group added to
   * another bar starts with none there, so it takes that bar's style.
   */
  barAppearance: Record<string, AppearanceOverrides | null>;
  /** Tag conditions people must all pass to see it; empty = no filter. */
  tagFilter: TagCondition[];
  stories: StoryDto[];
  createdAt: string;
  updatedAt: string;
}
