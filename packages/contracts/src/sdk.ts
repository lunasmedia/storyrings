import { z } from 'zod';
import { activityTypes, eventTypes, platforms } from './sdk-types';

export type {
  AnswerDto,
  AnswerResultsDto,
  FeedDto,
  FeedGroupDto,
  FeedInteractionDto,
  FeedStoryDto,
  SdkEventDto,
} from './sdk-types';

import { id } from './common';

export const MAX_EVENTS_PER_BATCH = 50;

/** Public tokens look like pk_live_ followed by 24 base62 characters. */
export const publicToken = z.string().regex(/^pk_live_[A-Za-z0-9]{24}$/, 'Invalid token');

const storyEvent = z.object({
  type: z.enum(eventTypes),
  groupId: id,
  storyId: id.optional(),
  /** Key of the story bar it happened in; omitted = the main bar. */
  bar: z.string().max(40).optional(),
  /** Client timestamp, ms since epoch. */
  ts: z.number().int().positive(),
});

/** Page views and app sessions: no story group. */
const activityEvent = z.object({
  type: z.enum(activityTypes),
  ts: z.number().int().positive(),
});

export const sdkEvent = z.union([storyEvent, activityEvent]);
export type SdkEvent = z.infer<typeof sdkEvent>;

export const eventBatch = z.object({
  /** e.g. "web@0.1.0" */
  sdk: z.string().max(40).optional(),
  sessionId: z.string().max(64).optional(),
  /** Anonymous ID made on the device, used only to count unique viewers (reach). */
  viewer: z.string().min(8).max(64).optional(),
  /** Where the batch came from (desktop / mobile web / iOS / Android). */
  platform: z.enum(platforms).optional(),
  /** The browser is driven by automation (navigator.webdriver): filtered as invalid traffic. */
  automation: z.boolean().optional(),
  events: z.array(sdkEvent).min(1).max(MAX_EVENTS_PER_BATCH),
});
export type EventBatch = z.infer<typeof eventBatch>;

export const answerInput = z.object({
  storyId: id,
  interactionId: z.string().min(1).max(40),
  value: z.number().int().min(0).max(100),
  viewer: z.string().min(8).max(64).optional(),
});
