import { z } from 'zod';

import type { EventType } from './sdk-types';

export { type EventType, eventTypes } from './sdk-types';

export const analyticsQuery = z.object({
  /** Inclusive, YYYY-MM-DD (UTC). Defaults to 29 days before `to`. */
  from: z.iso.date().optional(),
  /** Inclusive, YYYY-MM-DD (UTC). Defaults to today. */
  to: z.iso.date().optional(),
  by: z.enum(['day', 'group', 'story']).default('day'),
});
export type AnalyticsQuery = z.input<typeof analyticsQuery>;

export type EventCounts = Record<EventType, number>;

export interface AnalyticsRowDto {
  /** A date (by=day), group id (by=group) or story id (by=story). */
  key: string;
  /** Group title, or "Group title · #n" for stories. Absent for days. */
  label?: string;
  counts: EventCounts;
}

/** Traffic and active users where the SDK runs (docs/metrics.md, "Audience"). */
export interface AudienceDto {
  /** Unique people who used the iOS or Android app in the period (apps only, not web). */
  activeUsers: number;
  /** Active users per app platform. */
  usersByPlatform: { ios: number; android: number };
  /** Page loads with the SDK (web). */
  pageViews: { desktop: number; mobile_web: number; total: number };
  /** App sessions: opens, and returns after 30+ minutes away (apps). */
  sessions: { ios: number; android: number; total: number };
  /** App active users who also had a story impression (for story reach rate; ≤ activeUsers). */
  reachedUsers: number;
  /** Unique website visitors in the period (web only), and per web platform. */
  visitors: number;
  visitorsByPlatform: { desktop: number; mobile_web: number };
  /** Website visitors who also had a story impression (for website story reach rate). */
  reachedVisitors: number;
}

/** Unique people, counted with the SDKs' anonymous viewer IDs (see docs/metrics.md). */
export interface ReachDto {
  /** People with at least one story impression (MRC/IAB viewable). */
  viewers: number;
}

export interface AnalyticsDto {
  from: string;
  to: string;
  by: 'day' | 'group' | 'story';
  totals: EventCounts;
  reach: ReachDto;
  rows: AnalyticsRowDto[];
}

/** Org-wide summary for the dashboard's Home page. */
export const overviewQuery = analyticsQuery.pick({ from: true, to: true }).extend({
  /** Limit to one app; omitted = every app in the organization. */
  appId: z.uuid().optional(),
  /** Limit to one story bar of `appId` (story metrics only; traffic stays app-wide). */
  barId: z.uuid().optional(),
});
export type OverviewQuery = z.input<typeof overviewQuery>;

export interface OverviewGroupDto {
  id: string;
  title: string;
  appId: string;
  appName: string;
  /** Circle cover image, if the group has one. */
  coverUrl: string | null;
  counts: EventCounts;
  /** People who watched at least one of its stories. */
  viewers: number;
}

export interface OverviewStoryDto {
  id: string;
  /** Unique people with an impression of this story in the period (story reach). */
  viewers: number;
  groupId: string;
  groupTitle: string;
  /** The story's own name, or null when it uses the group title. */
  title: string | null;
  /** 0-based position in its group. */
  position: number;
  /** Screen-reader description, which usually says what the story is about. */
  alt: string;
  appName: string;
  type: 'image' | 'video';
  /** A picture for the story: the image itself, or the group cover for videos. */
  thumbUrl: string | null;
  /** The story's own image or video, for previews. */
  mediaUrl: string;
  /** How long the story plays (images: its set duration; videos: their length). */
  durationMs: number;
  counts: EventCounts;
}

/** A story group that went live in the period (for marking launches on the chart). */
export interface OverviewLaunchDto {
  id: string;
  title: string;
  appId: string;
  appName: string;
  /** Circle cover image, if the group has one. */
  coverUrl: string | null;
  /** When the group was created (ISO timestamp). */
  createdAt: string;
  /**
   * When it went live (ISO timestamp): when it was published, or its scheduled start if
   * that came later.
   */
  liveAt: string;
}

export interface OverviewDto {
  from: string;
  to: string;
  /** The period of the same length just before, for comparisons. */
  previous: {
    from: string;
    to: string;
    totals: EventCounts;
    reach: ReachDto;
    audience: AudienceDto;
  };
  totals: EventCounts;
  reach: ReachDto;
  audience: AudienceDto;
  /** Events excluded as General Invalid Traffic in the period, by reason. */
  filtered: {
    total: number;
    botUserAgent: number;
    automation: number;
    missingUserAgent: number;
  };
  /**
   * Every day from..to, including days without events. `viewers` = that day's reach,
   * `activeUsers` that day's active users; page views and sessions are daily totals.
   */
  days: {
    day: string;
    counts: EventCounts;
    viewers: number;
    activeUsers: number;
    visitors: number;
    pageViews: number;
    sessions: number;
  }[];
  /** Groups and stories with any activity in the period (deleted ones are left out). */
  groups: OverviewGroupDto[];
  stories: OverviewStoryDto[];
  /**
   * Groups that went live in the period and are live now (published; scheduled ones once
   * their start has passed), oldest first. Drafts never appear.
   */
  launches: OverviewLaunchDto[];
}
