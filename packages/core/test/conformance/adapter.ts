/**
 * Runs the language-neutral conformance cases in /spec against the TypeScript SDK code.
 * Each suite maps a case's JSON `input` to a JSON result; the conformance test compares that
 * with the case's `expect`. Other SDKs (Flutter, Swift, Kotlin) implement the same mapping
 * in their own test runner (see spec/README.md).
 */
import { IMAGE_DURATION_DEFAULT_MS } from '@stories/contracts';
import { ctaStyle, isAllowedCtaUrl, isSwipeCta } from '@stories/contracts/cta';
import {
  MAX_TAG_CONDITIONS,
  MAX_USER_TAGS,
  matchesTagFilter,
  normalizeTags,
  TAG_MAX_LENGTH,
  TAG_PATTERN,
  type TagCondition,
} from '@stories/contracts/tags';
import {
  ANSWERS_MAX_IDS,
  AnalyticsQueue,
  actionEvents,
  appShareUrl,
  CLOSED,
  CORRECT_COLOR,
  countdownParts,
  DEFAULT_ACCENT,
  DEFAULT_SLIDER_EMOJI,
  GestureRecognizer,
  type GroupLike,
  INTERACTION_UNITS,
  interactionLabels,
  labels,
  loadViewerId,
  normalizeFeed,
  openViewer,
  parseInteractions,
  parseShareLink,
  percentages,
  placeInteraction,
  progressSegments,
  reduce,
  SESSION_TIMEOUT_MS,
  SeenStore,
  StoriesError,
  shareUrl,
  startsNewSession,
  storyLook,
  TAP_MAX_MS,
  type TrackedEvent,
  transitionEvents,
  VIEWABLE_MS,
  VIEWER_ID_MAX_AGE_MS,
  type ViewerAction,
  type ViewerState,
  WRONG_COLOR,
  withoutShareLink,
} from '../../src/index.js';

type Json = unknown;
// Case inputs are free-form JSON; each suite reads the fields it documents.
type Input = any;

export const suites: Record<string, (input: Input) => Json | Promise<Json>> = {
  viewer: runViewer,
  feed: runFeed,
  tags: runTags,
  links: runLinks,
  gestures: runGestures,
  seen: runSeen,
  analytics: runAnalytics,
  sessions: runSessions,
  interactions: runInteractions,
  display: (input: Input) => storyLook(input.story),
};

/** Values every SDK uses as-is (spec/constants.json). Not cases: generated from the code. */
export function constants(): Json {
  return {
    viewableMs: VIEWABLE_MS,
    tapMaxMs: TAP_MAX_MS,
    sessionTimeoutMs: SESSION_TIMEOUT_MS,
    viewerIdMaxAgeMs: VIEWER_ID_MAX_AGE_MS,
    imageDurationDefaultMs: IMAGE_DURATION_DEFAULT_MS,
    analytics: { flushIntervalMs: 5000, maxBatch: 50, maxQueue: 500 },
    seenMaxIds: 1000,
    tags: {
      pattern: TAG_PATTERN.source,
      maxLength: TAG_MAX_LENGTH,
      maxPerPerson: MAX_USER_TAGS,
      maxConditions: MAX_TAG_CONDITIONS,
    },
    storage: {
      seen: 'stories:seen:<appId>',
      viewer: 'stories:viewer',
      feed: 'stories:feed:<token>[:<barKey>][#<tags>]',
      answers: 'stories:answers:<appId>',
    },
    labels: {
      openGroup: [labels.openGroup('Sale', 1, false), labels.openGroup('Sale', 3, true)],
      storyPosition: labels.storyPosition('Sale', 0, 3),
      viewer: labels.viewer('Sale'),
      close: labels.close,
      pause: labels.pause,
      play: labels.play,
      mute: labels.mute,
      unmute: labels.unmute,
      previous: labels.previous,
      next: labels.next,
      share: labels.share,
      linkCopied: labels.linkCopied,
      shareFailed: labels.shareFailed,
      bar: labels.bar,
      loading: labels.loading,
      countdownUnits: [...interactionLabels.countdownUnits],
      countdownEnded: interactionLabels.countdownEnded,
      pollOption: interactionLabels.pollOption('Red', 40),
      slider: interactionLabels.slider('How hot?'),
      sliderAverage: interactionLabels.sliderAverage,
    },
    answersMaxIds: ANSWERS_MAX_IDS,
    interactions: {
      unitsPerWidth: INTERACTION_UNITS,
      defaultAccent: DEFAULT_ACCENT,
      defaultEmoji: DEFAULT_SLIDER_EMOJI,
      correctColor: CORRECT_COLOR,
      wrongColor: WRONG_COLOR,
    },
  };
}

// --- viewer -------------------------------------------------------------------------------

/**
 * input: { groups, open: groupIndex, startStoryIndex?: { [groupIndex]: storyIndex }, steps: action[] }
 * result: the state after opening and after each action, with the events each one produces
 * (action events first, then transition events) and the progress bars.
 */
function runViewer(input: Input): Json {
  const groups = input.groups as GroupLike[];
  const starts = (input.startStoryIndex ?? {}) as Record<string, number>;
  const opts = { startStoryIndex: (g: number) => starts[String(g)] ?? 0 };
  const opened = openViewer(groups, input.open, opts);
  let state = opened;
  const steps = (input.steps as ViewerAction[]).map((action) => {
    const next = reduce(state, action, groups, opts);
    const events = [
      ...actionEvents(state, action, groups),
      ...transitionEvents(state, next, groups),
    ];
    state = next;
    return {
      action,
      state: snapshot(next, groups),
      events,
      progress: progressSegments(next, groups),
    };
  });
  return {
    opened: snapshot(opened, groups),
    events: transitionEvents(CLOSED, opened, groups),
    steps,
  };
}

function snapshot(s: ViewerState, groups: readonly GroupLike[]) {
  return {
    at: s.open ? (groups[s.groupIndex]?.stories[s.storyIndex]?.id ?? null) : 'closed',
    ...s,
  };
}

// --- feed ---------------------------------------------------------------------------------

/** input: { body }: a /v1/feed response. result: the normalised feed, or { error: code }. */
function runFeed(input: Input): Json {
  try {
    return { feed: normalizeFeed(input.body) };
  } catch (err) {
    if (err instanceof StoriesError) return { error: err.code };
    throw err;
  }
}

// --- tags ---------------------------------------------------------------------------------

/** input: { op: 'normalize', tags } | { op: 'filter', conditions, tags } */
function runTags(input: Input): Json {
  if (input.op === 'normalize') return { tags: normalizeTags(input.tags) };
  return {
    matches: matchesTagFilter(input.conditions as TagCondition[], new Set(input.tags as string[])),
  };
}

// --- links --------------------------------------------------------------------------------

/** Share links (web and app) and which button links may open. */
function runLinks(input: Input): Json {
  switch (input.op) {
    case 'shareUrl':
      return { url: shareUrl(input.pageUrl, input.target) };
    case 'parseShareLink':
      return { target: parseShareLink(input.url) };
    case 'withoutShareLink':
      return { url: withoutShareLink(input.url) };
    case 'appShareUrl':
      return { url: appShareUrl(input.template, input.target) };
    case 'ctaAllowed':
      return { allowed: isAllowedCtaUrl(input.url, input.schemes ?? []) };
    case 'ctaStyle': {
      const style = ctaStyle(input.style);
      return { style, swipe: isSwipeCta(style) };
    }
    default:
      throw new Error(`Unknown links op ${input.op}`);
  }
}

// --- gestures -----------------------------------------------------------------------------

/**
 * input: { width, events: [['down', x, y, t] | ['move', x, y] | ['up', x, y, t] | ['cancel']] }
 * result: the recognised calls in order, e.g. ['press'], ['tap', 0.25], ['swipe', 'left'].
 */
function runGestures(input: Input): Json {
  const calls: Json[] = [];
  const r = new GestureRecognizer({
    onPress: () => calls.push(['press']),
    onRelease: () => calls.push(['release']),
    onTap: (x) => calls.push(['tap', Math.round(x * 1000) / 1000]),
    onSwipe: (d) => calls.push(['swipe', d]),
    onDrag: (dx, dy) => calls.push(['drag', dx, dy]),
  });
  for (const [kind, ...args] of input.events as [string, ...number[]][]) {
    if (kind === 'down') r.down(args[0]!, args[1]!, args[2]!);
    else if (kind === 'move') r.move(args[0]!, args[1]!);
    else if (kind === 'up') r.up(args[0]!, args[1]!, args[2]!, input.width);
    else r.cancel();
  }
  return { calls };
}

// --- seen ---------------------------------------------------------------------------------

/**
 * input: { ops: [['markSeen', id] | ['markMany', prefix, count] | ['has', id] |
 *   ['isGroupSeen', storyIds] | ['firstUnseenIndex', storyIds]] }
 * result: one entry per op (null for ops that return nothing).
 */
async function runSeen(input: Input): Promise<Json> {
  const store = new SeenStore(null, 'app');
  await store.load();
  const group = (ids: string[]) => ({ id: 'g', stories: ids.map((id) => ({ id, durationMs: 1 })) });
  const results = (input.ops as [string, ...Input[]][]).map(([op, a, b]) => {
    switch (op) {
      case 'markSeen':
        store.markSeen(a);
        return null;
      case 'markMany':
        for (let i = 0; i < b; i++) store.markSeen(`${a}${i}`);
        return null;
      case 'has':
        return store.has(a);
      case 'isGroupSeen':
        return store.isGroupSeen(group(a));
      case 'firstUnseenIndex':
        return store.firstUnseenIndex(group(a));
      default:
        throw new Error(`Unknown seen op ${op}`);
    }
  });
  return { results };
}

// --- analytics ----------------------------------------------------------------------------

/**
 * input: { options: { sdk, sessionId, maxBatch?, maxQueue?, platform?, viewer?, automation? },
 *   steps: [{ track: event, at: ms } | { flush: { beacon?, fail? } }] }
 * `fail: n` makes the next n sends fail. Batches only go out when full or on flush (the timer
 * is left out). result: per step, the batches sent (parsed) and how many events are waiting.
 */
async function runAnalytics(input: Input): Promise<Json> {
  let now = 0;
  let failNext = 0;
  const sent: { body: Json; beacon: boolean }[] = [];
  const { viewer, ...options } = input.options;
  const queue = new AnalyticsQueue({
    url: 'https://api.example.com/v1/events?token=pk_live_x',
    flushIntervalMs: 1e9,
    now: () => now,
    ...(viewer ? { viewer: () => viewer } : {}),
    ...options,
    transport: {
      async send(_url, body, { beacon }) {
        sent.push({ body: JSON.parse(body), beacon });
        if (failNext > 0) {
          failNext--;
          throw new Error('network');
        }
      },
    },
  });
  const steps: Json[] = [];
  for (const step of input.steps) {
    const before = sent.length;
    if (step.track) {
      now = step.at ?? now;
      queue.track(step.track as TrackedEvent);
      await settle();
    } else if (step.flush) {
      failNext = step.flush.fail ?? 0;
      await queue.flush({ beacon: !!step.flush.beacon });
      await settle();
    }
    steps.push({ sent: sent.slice(before), pending: queue.pending });
  }
  // The flush timer isn't part of the cases; stop it so nothing fires later.
  (queue as unknown as { clearTimer(): void }).clearTimer();
  return { steps };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- sessions -----------------------------------------------------------------------------

/**
 * input: { op: 'newSession', leftAt, now } — whether coming back starts a new app session;
 *   { op: 'viewerId', stored, now } — whether a stored anonymous ID is kept or replaced.
 */
async function runSessions(input: Input): Promise<Json> {
  if (input.op === 'newSession') return { newSession: startsNewSession(input.leftAt, input.now) };
  const data = new Map<string, string>();
  if (input.stored !== undefined) {
    data.set(
      'stories:viewer',
      typeof input.stored === 'string' ? input.stored : JSON.stringify(input.stored),
    );
  }
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
  const id = await loadViewerId(storage, input.now);
  const keptId = typeof input.stored === 'object' && input.stored ? input.stored.id : undefined;
  return { kept: id !== null && id === keptId, stored: data.get('stories:viewer') !== undefined };
}

function runInteractions(input: Input): Json {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  switch (input.op) {
    case 'parse':
      return { interactions: parseInteractions(input.interactions) };
    case 'place': {
      const [w, h] = input.container;
      const media = input.media ? { width: input.media[0], height: input.media[1] } : null;
      const p = placeInteraction({ width: w, height: h }, media, input.fit, input);
      return { x: r3(p.x), y: r3(p.y), width: r3(p.width), scale: r3(p.scale) };
    }
    case 'percentages':
      return { percents: percentages(input.counts) };
    case 'countdown':
      return countdownParts(input.endsAt, Date.parse(input.now));
    default:
      throw new Error(`unknown op ${input.op}`);
  }
}
