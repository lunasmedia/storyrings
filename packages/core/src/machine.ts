/**
 * The story viewer as a pure state machine. Renderers (web, React Native)
 * dispatch actions from taps, swipes, keys and timers, and draw whatever state
 * comes back. Keeping it pure makes navigation easy to test.
 */

export interface StoryLike {
  id: string;
  durationMs: number;
  /** Decides the viewability rule (images: 1 s on screen; videos: 2 s of playback). */
  type?: 'image' | 'video';
}

/**
 * MRC/IAB viewability, applied to stories (docs/metrics.md): a story counts as viewed
 * after this much continuous time once its media has rendered. Images need 1 second
 * on screen; videos need 2 seconds of continuous playback.
 */
export const VIEWABLE_MS = { image: 1000, video: 2000 } as const;

export interface GroupLike {
  id: string;
  stories: readonly StoryLike[];
}

export type CloseReason = 'user' | 'completed';

export interface ViewerState {
  open: boolean;
  groupIndex: number;
  storyIndex: number;
  /** Time shown so far for the current story. */
  elapsedMs: number;
  /** Duration of the current story (videos may report a more exact value when loaded). */
  durationMs: number;
  /** Paused by the user (hold, pause button, hidden tab). */
  paused: boolean;
  /** Current media is still loading. The timer doesn't run while buffering. */
  buffering: boolean;
  /**
   * The current story's media has been on screen (loaded and drawn); stays false if
   * the media failed.
   */
  displayed: boolean;
  /** The viewer is off screen (hidden tab, app in the background). */
  hidden: boolean;
  /** Continuous viewable time of the current story so far (see VIEWABLE_MS). */
  viewableMs: number;
  /** The current story has met the viewability rule; analytics count it as viewed. */
  viewed: boolean;
  closeReason: CloseReason | null;
  /**
   * Increments every time a story starts (including restarting the same one).
   * Renderers (re)load media when it changes.
   */
  seq: number;
}

export type ViewerAction =
  /** `auto`: the story ended by itself (a video finished), not a tap. */
  | { type: 'NEXT'; auto?: boolean }
  | { type: 'PREV' }
  | { type: 'NEXT_GROUP' }
  | { type: 'PREV_GROUP' }
  | { type: 'TICK'; ms: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'MEDIA_LOADING' }
  /** The viewer went off screen / came back (tab hidden, app backgrounded). */
  | { type: 'HIDE' }
  | { type: 'SHOW' }
  /** Media can play. `failed`: it couldn't be loaded; the timer runs anyway so the viewer moves on. */
  | { type: 'MEDIA_READY'; durationMs?: number; failed?: boolean }
  | { type: 'CLOSE' };

export interface MachineOptions {
  /**
   * Story to start at when entering a group going forward. Defaults to 0.
   * Renderers pass "first unseen story" here, as Instagram does.
   */
  startStoryIndex?: (groupIndex: number) => number;
}

export const CLOSED: ViewerState = {
  open: false,
  groupIndex: 0,
  storyIndex: 0,
  elapsedMs: 0,
  durationMs: 0,
  paused: false,
  buffering: false,
  displayed: false,
  hidden: false,
  viewableMs: 0,
  viewed: false,
  closeReason: null,
  seq: 0,
};

function show(
  s: Pick<ViewerState, 'seq' | 'hidden'>,
  groups: readonly GroupLike[],
  groupIndex: number,
  storyIndex: number,
): ViewerState {
  const story = groups[groupIndex]?.stories[storyIndex];
  if (!story) return { ...CLOSED, closeReason: 'completed', seq: s.seq };
  return {
    open: true,
    groupIndex,
    storyIndex,
    elapsedMs: 0,
    durationMs: story.durationMs,
    paused: false,
    buffering: true,
    displayed: false,
    hidden: s.hidden,
    viewableMs: 0,
    viewed: false,
    closeReason: null,
    seq: s.seq + 1,
  };
}

function entryIndex(
  groups: readonly GroupLike[],
  groupIndex: number,
  opts: MachineOptions,
): number {
  const count = groups[groupIndex]?.stories.length ?? 0;
  const wanted = opts.startStoryIndex?.(groupIndex) ?? 0;
  return wanted >= 0 && wanted < count ? wanted : 0;
}

/** Opens the viewer on a group (at its start story). */
export function openViewer(
  groups: readonly GroupLike[],
  groupIndex: number,
  opts: MachineOptions = {},
): ViewerState {
  if (!groups[groupIndex]?.stories.length) return CLOSED;
  return show(CLOSED, groups, groupIndex, entryIndex(groups, groupIndex, opts));
}

function nextGroup(s: ViewerState, groups: readonly GroupLike[], opts: MachineOptions) {
  const g = s.groupIndex + 1;
  if (g >= groups.length) return { ...CLOSED, closeReason: 'completed' as const, seq: s.seq };
  return show(s, groups, g, entryIndex(groups, g, opts));
}

export function reduce(
  s: ViewerState,
  action: ViewerAction,
  groups: readonly GroupLike[],
  opts: MachineOptions = {},
): ViewerState {
  if (!s.open) return s;
  const group = groups[s.groupIndex];
  if (!group) return { ...CLOSED, closeReason: 'user', seq: s.seq };
  const lastStory = group.stories.length - 1;

  switch (action.type) {
    case 'NEXT':
      return s.storyIndex < lastStory
        ? show(s, groups, s.groupIndex, s.storyIndex + 1)
        : nextGroup(s, groups, opts);

    case 'PREV': {
      if (s.storyIndex > 0) return show(s, groups, s.groupIndex, s.storyIndex - 1);
      if (s.groupIndex > 0) {
        // Like Instagram: going back from a group's first story lands on the
        // previous group's last story.
        const prev = groups[s.groupIndex - 1]!;
        return show(s, groups, s.groupIndex - 1, prev.stories.length - 1);
      }
      // Very first story: restart it.
      return show(s, groups, 0, 0);
    }

    case 'NEXT_GROUP':
      return nextGroup(s, groups, opts);

    case 'PREV_GROUP':
      return show(s, groups, Math.max(0, s.groupIndex - 1), 0);

    case 'TICK': {
      if (action.ms <= 0) return s;
      const story = group.stories[s.storyIndex];
      const video = story?.type === 'video';
      // Images are viewable while on screen (even when held paused); videos only while
      // actually playing.
      const accruing =
        s.displayed && !s.viewed && !s.hidden && (!video || (!s.paused && !s.buffering));
      const viewableMs = accruing ? s.viewableMs + action.ms : s.viewableMs;
      const justViewed = accruing && viewableMs >= VIEWABLE_MS[video ? 'video' : 'image'];
      if (s.paused || s.buffering) {
        return accruing ? { ...s, viewableMs, viewed: justViewed } : s;
      }
      const elapsedMs = s.elapsedMs + action.ms;
      // Report the view before moving on, so a story that ends right as it qualifies counts.
      if (justViewed) {
        return { ...s, viewableMs, viewed: true, elapsedMs: Math.min(elapsedMs, s.durationMs) };
      }
      if (elapsedMs >= s.durationMs) return reduce(s, { type: 'NEXT' }, groups, opts);
      return { ...s, elapsedMs, viewableMs };
    }

    case 'HIDE':
      // Off screen breaks continuity: the count starts again when it's back.
      return s.hidden ? s : { ...s, hidden: true, viewableMs: s.viewed ? s.viewableMs : 0 };

    case 'SHOW':
      return s.hidden ? { ...s, hidden: false } : s;

    case 'PAUSE':
      // A paused video isn't playing, so its continuous playback count restarts.
      return s.paused ? s : { ...s, paused: true, viewableMs: restartVideo(s, group) };

    case 'RESUME':
      return s.paused ? { ...s, paused: false } : s;

    case 'MEDIA_LOADING':
      return s.buffering ? s : { ...s, buffering: true, viewableMs: restartVideo(s, group) };

    case 'MEDIA_READY': {
      const durationMs =
        action.durationMs && Number.isFinite(action.durationMs) && action.durationMs > 0
          ? action.durationMs
          : s.durationMs;
      return { ...s, buffering: false, durationMs, displayed: s.displayed || !action.failed };
    }

    case 'CLOSE':
      return { ...CLOSED, closeReason: 'user', seq: s.seq };
  }
}

/** Continuous playback restarts for a not-yet-viewed video; images keep their count. */
function restartVideo(s: ViewerState, group: GroupLike): number {
  return !s.viewed && group.stories[s.storyIndex]?.type === 'video' ? 0 : s.viewableMs;
}

/** Fill (0..1) of each progress segment in the current group. */
export function progressSegments(s: ViewerState, groups: readonly GroupLike[]): number[] {
  const group = groups[s.groupIndex];
  if (!s.open || !group) return [];
  const current = s.durationMs > 0 ? Math.min(1, s.elapsedMs / s.durationMs) : 0;
  return group.stories.map((_, i) => (i < s.storyIndex ? 1 : i === s.storyIndex ? current : 0));
}
