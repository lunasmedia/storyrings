/**
 * Dependency-free types for the public SDK API. SDKs import these from
 * "@stories/contracts/sdk-types" so their bundles and .d.ts never touch Zod.
 */

import type { Appearance, BarLayout, CoverDto } from './appearance';
import type { CtaStyle } from './cta';

export type { Appearance, AppearanceOverrides, BarLayout, CoverDto } from './appearance';
export type { CtaStyle } from './cta';

export const eventTypes = [
  'impression',
  'group_open',
  'story_view',
  'cta_click',
  'group_complete',
  'share',
  'tap_forward',
  'tap_back',
  'group_skip',
  'exit',
] as const;
export type EventType = (typeof eventTypes)[number];

/**
 * Activity outside the story bar, for active users and traffic: a page load with the SDK
 * (web) or an app session starting (apps). They belong to no story group.
 */
export const activityTypes = ['page_view', 'app_open'] as const;
export type ActivityType = (typeof activityTypes)[number];

/** Where an event came from. Tablets count as mobile web. */
export const platforms = ['desktop', 'mobile_web', 'ios', 'android'] as const;
export type Platform = (typeof platforms)[number];

export type StoryType = 'image' | 'video';

export interface FeedStoryDto {
  id: string;
  /** Name shown at the top of the story (the story's own name, or the group title). */
  title?: string;
  type: StoryType;
  url: string;
  durationMs: number;
  width: number | null;
  height: number | null;
  alt: string;
  /** `style` is absent from older servers ("pill"). */
  cta: { label: string; url: string; style?: CtaStyle } | null;
  /** Interactive stickers drawn over the image; absent from older servers. */
  interactions?: FeedInteractionDto[];
  /**
   * How it fits the screen: "fill" covers it (edges may be cropped on some phones), "fit" shows
   * all of it, with any gaps in `fill` colours. Absent from older servers ("fit", black gaps).
   */
  fit?: StoryFit;
  /** Gap colours for "fit": top to bottom. Null = black. */
  fill?: StoryFill | null;
  /**
   * Videos designed in the studio: a transparent 1080 × 1920 image of their text, shapes and
   * stickers, drawn over the video, fitted to the screen as a 1080 × 1920 story image would be
   * (`fit`). Absent: nothing to draw.
   */
  overlay?: string;
}

export type StoryFit = 'fill' | 'fit';
export interface StoryFill {
  /** "#rrggbb". */
  top: string;
  bottom: string;
}

/**
 * An interactive sticker, placed in the story image's 1080 × 1920 design space: `x`, `y` are
 * its centre and `width` its width there. Each SDK maps them onto the image as displayed.
 */
export type FeedInteractionDto = {
  id: string;
  x: number;
  y: number;
  width: number;
  accent: string;
} & (
  | { kind: 'poll'; question: string; options: string[] }
  | { kind: 'quiz'; question: string; options: string[]; correct: number }
  | { kind: 'slider'; question: string; emoji: string }
  | { kind: 'link'; label: string; url: string }
  | { kind: 'countdown'; title: string; endsAt: string }
);

/** What people answered so far: votes per option (poll, quiz) or the average (slider, 0–100). */
export interface AnswerResultsDto {
  total: number;
  counts?: number[];
  average?: number;
}

/** POST /v1/answers: one person's answer to a poll, quiz or slider. */
export interface AnswerDto {
  storyId: string;
  interactionId: string;
  /** Option index (poll, quiz) or slider position 0–100. */
  value: number;
  /** Anonymous viewer ID, so one person counts once. */
  viewer?: string;
}

export interface FeedGroupDto {
  id: string;
  title: string;
  /** Still cover image (also the poster of animated covers). */
  coverUrl: string;
  /** Circle cover renditions; absent from older servers. */
  cover?: CoverDto;
  /** Resolved circle appearance; absent from older servers (SDK theme is used instead). */
  appearance?: Appearance;
  /** Schedule end, for countdown badges. */
  endsAt?: string | null;
  updatedAt: string;
  stories: FeedStoryDto[];
}

export interface FeedDto {
  app: {
    id: string;
    deepLinkSchemes: string[];
    /** Viewers may share stories (absent from older servers = off). */
    sharing?: boolean;
    /**
     * Mobile apps: the link shared stories open, with {group} and {story} placeholders
     * (websites share the page URL instead).
     */
    shareLink?: string;
    /** Shape and size set in the dashboard; absent = the SDK theme's size is used. */
    layout?: BarLayout;
  };
  /** The story bar this feed is for (absent from older servers). */
  bar?: { id: string; key: string };
  groups: FeedGroupDto[];
}

/** One analytics event as sent to POST /v1/events: a story event, or activity (no group). */
export type SdkEventDto =
  | {
      type: EventType;
      groupId: string;
      storyId?: string;
      /** Key of the story bar it happened in; omitted = the main bar. */
      bar?: string;
      /** Client timestamp, ms since epoch. */
      ts: number;
    }
  | { type: ActivityType; ts: number };
