import type { ActivityType, EventType, Platform, SdkEventDto } from '@stories/contracts/sdk-types';
import type { GroupLike, ViewerAction, ViewerState } from './machine';
import { randomId } from './viewer';

/** A story event: about a group (and story) in the bar or viewer. */
export interface StoryEvent {
  type: EventType;
  groupId: string;
  storyId?: string;
  /** Key of the story bar it happened in; omitted = the main bar. */
  bar?: string;
}

/** Activity outside the bar: a page view (web) or app session start (apps). */
export interface ActivityEvent {
  type: ActivityType;
}

export type TrackedEvent = StoryEvent | ActivityEvent;

/**
 * Derives analytics events from a viewer state transition (definitions in docs/metrics.md):
 * - group_open when the viewer opens on a group or moves on to another one
 * - story_view once a story meets the MRC/IAB viewability rule (VIEWABLE_MS): 1 s on
 *   screen for images, 2 s of continuous playback for videos, after the media rendered
 * - group_complete when moving forward past a group's last story after it was shown
 */
export function transitionEvents(
  prev: ViewerState,
  next: ViewerState,
  groups: readonly GroupLike[],
): StoryEvent[] {
  const events: StoryEvent[] = [];
  const prevGroup = groups[prev.groupIndex];

  if (prev.open && prevGroup) {
    const wasLast = prev.storyIndex === prevGroup.stories.length - 1;
    const movedForward = next.open
      ? next.groupIndex > prev.groupIndex
      : next.closeReason === 'completed';
    if (wasLast && movedForward && prev.displayed) {
      events.push({ type: 'group_complete', groupId: prevGroup.id });
    }
  }

  if (!next.open) return events;
  const group = groups[next.groupIndex];
  const story = group?.stories[next.storyIndex];
  if (!group || !story) return events;
  const sameStory = prev.open && prev.seq === next.seq;

  if (!sameStory && (!prev.open || prev.groupIndex !== next.groupIndex)) {
    events.push({ type: 'group_open', groupId: group.id });
  }
  if (next.viewed && !(sameStory && prev.viewed)) {
    events.push({ type: 'story_view', groupId: group.id, storyId: story.id });
  }
  return events;
}

/**
 * Events for how a viewer moves through stories, derived from the action itself (a state
 * change alone can't tell a tap from a story ending). Call with the state before the action.
 * - tap_forward: NEXT by the viewer (not a story ending by itself)
 * - tap_back: PREV
 * - group_skip: NEXT_GROUP, jumping to the next group from the current story
 * - exit: CLOSE, the viewer closing it
 */
export function actionEvents(
  state: ViewerState,
  action: ViewerAction,
  groups: readonly GroupLike[],
): StoryEvent[] {
  if (!state.open) return [];
  const group = groups[state.groupIndex];
  const story = group?.stories[state.storyIndex];
  if (!group || !story) return [];
  const type =
    action.type === 'NEXT'
      ? action.auto
        ? null
        : 'tap_forward'
      : action.type === 'PREV'
        ? 'tap_back'
        : action.type === 'NEXT_GROUP'
          ? 'group_skip'
          : action.type === 'CLOSE'
            ? 'exit'
            : null;
  return type ? [{ type, groupId: group.id, storyId: story.id }] : [];
}

export interface Transport {
  /**
   * Sends one batch. `beacon` is true when the page/app is going away and the
   * request must survive it (navigator.sendBeacon on the web).
   */
  send(url: string, body: string, opts: { beacon: boolean }): Promise<void>;
}

/** Default transport: fetch with keepalive, JSON sent as text/plain (no CORS preflight). */
export const fetchTransport: Transport = {
  async send(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body,
      keepalive: true,
      credentials: 'omit',
    });
    if (!res.ok && res.status >= 500) throw new Error(`HTTP ${res.status}`);
  },
};

export interface AnalyticsQueueOptions {
  url: string;
  sdk: string;
  transport?: Transport;
  flushIntervalMs?: number;
  maxBatch?: number;
  /** Cap on events held while the network is failing. */
  maxQueue?: number;
  now?: () => number;
  sessionId?: string;
  /** The anonymous viewer ID to send for reach, if there is one (read at send time). */
  viewer?: () => string | null;
  /** Where events come from (desktop / mobile web / iOS / Android). */
  platform?: Platform;
  /** The browser is automated (e.g. navigator.webdriver); the server filters these out. */
  automation?: boolean;
}

/** Batches events and sends them every few seconds, or immediately when the batch is full. */
export class AnalyticsQueue {
  private queue: SdkEventDto[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private readonly opts: Required<
    Omit<AnalyticsQueueOptions, 'sessionId' | 'viewer' | 'platform' | 'automation'>
  > & {
    sessionId: string;
    viewer?: () => string | null;
    platform?: Platform;
    automation?: boolean;
  };

  constructor(opts: AnalyticsQueueOptions) {
    this.opts = {
      transport: fetchTransport,
      flushIntervalMs: 5000,
      maxBatch: 50,
      maxQueue: 500,
      now: Date.now,
      sessionId: randomId(),
      ...opts,
    };
  }

  track(event: TrackedEvent): void {
    this.queue.push({ ...event, ts: this.opts.now() });
    if (this.queue.length > this.opts.maxQueue)
      this.queue.splice(0, this.queue.length - this.opts.maxQueue);
    if (this.queue.length >= this.opts.maxBatch) void this.flush();
    else this.schedule();
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Sends everything queued. With beacon=true, sends synchronously-queued batches for unload. */
  async flush({ beacon = false }: { beacon?: boolean } = {}): Promise<void> {
    this.clearTimer();
    if (this.inFlight && !beacon) await this.inFlight;
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.opts.maxBatch);
      const viewer = this.opts.viewer?.();
      const body = JSON.stringify({
        sdk: this.opts.sdk,
        sessionId: this.opts.sessionId,
        ...(viewer ? { viewer } : {}),
        ...(this.opts.platform ? { platform: this.opts.platform } : {}),
        ...(this.opts.automation ? { automation: true } : {}),
        events: batch,
      });
      const send = this.opts.transport.send(this.opts.url, body, { beacon });
      if (beacon) {
        void send.catch(() => {});
        continue;
      }
      this.inFlight = send;
      try {
        await send;
      } catch {
        // Put the batch back and retry on the next flush.
        this.queue.unshift(...batch);
        this.schedule();
        return;
      } finally {
        this.inFlight = null;
      }
    }
  }

  dispose(): void {
    this.clearTimer();
    void this.flush({ beacon: true });
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.opts.flushIntervalMs);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
