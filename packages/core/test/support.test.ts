import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnalyticsQueue,
  actionEvents,
  type Transport,
  transitionEvents,
} from '../src/analytics.js';
import { fetchFeed, normalizeFeed, StoriesError } from '../src/api.js';
import { CLOSED, type GroupLike, openViewer, reduce, type ViewerAction } from '../src/machine.js';
import { SeenStore } from '../src/seen.js';
import { resolveTheme } from '../src/theme.js';

const groups: GroupLike[] = [
  {
    id: 'A',
    stories: [
      { id: 'a1', durationMs: 5000 },
      { id: 'a2', durationMs: 5000 },
    ],
  },
  { id: 'B', stories: [{ id: 'b1', durationMs: 5000 }] },
];

describe('transitionEvents', () => {
  const READY: ViewerAction = { type: 'MEDIA_READY' };
  /** Applies actions; with `load`, media finishes loading after every navigation, like a real renderer. */
  function events(actions: ViewerAction[], { start = 0, load = true } = {}) {
    let st = CLOSED;
    let next = openViewer(groups, start);
    const out = transitionEvents(st, next, groups);
    const apply = (a: ViewerAction) => {
      st = next;
      next = reduce(st, a, groups);
      out.push(...transitionEvents(st, next, groups));
    };
    // Loaded and on screen for a second: a viewable image story.
    const watch = () => {
      apply(READY);
      apply({ type: 'TICK', ms: 1000 });
    };
    if (load) watch();
    for (const a of actions) {
      const seq = next.seq;
      apply(a);
      if (load && next.open && next.seq !== seq) watch();
    }
    return out.map((e) => `${e.type}:${e.storyId ?? e.groupId}`);
  }

  it('reports open, views, completion and the next group open', () => {
    expect(events([{ type: 'NEXT' }, { type: 'NEXT' }, { type: 'NEXT' }])).toEqual([
      'group_open:A',
      'story_view:a1',
      'story_view:a2',
      'group_complete:A',
      'group_open:B',
      'story_view:b1',
      'group_complete:B',
    ]);
  });

  it('does not report completion when the user closes or skips early', () => {
    expect(events([{ type: 'CLOSE' }])).toEqual(['group_open:A', 'story_view:a1']);
    expect(events([{ type: 'NEXT_GROUP' }])).toEqual([
      'group_open:A',
      'story_view:a1',
      'group_open:B',
      'story_view:b1',
    ]);
  });

  it('counts a story view only once its media is on screen', () => {
    // Tapped through before anything loaded: opens, but no views and no completion.
    expect(events([{ type: 'NEXT' }, { type: 'NEXT' }], { load: false })).toEqual([
      'group_open:A',
      'group_open:B',
    ]);
    // Media that fails to load isn't a view, even though the viewer moves on.
    let st = openViewer(groups, 0);
    const failed = reduce(st, { type: 'MEDIA_READY', failed: true }, groups);
    expect(transitionEvents(st, failed, groups)).toEqual([]);
    // Shown, but skipped before its viewable second: not a view.
    const shown = reduce(openViewer(groups, 0), READY, groups);
    const skipped = reduce(shown, { type: 'TICK', ms: 600 }, groups);
    expect(transitionEvents(shown, skipped, groups)).toEqual([]);
    // Re-buffering mid-video doesn't count the same story twice.
    st = reduce(reduce(openViewer(groups, 0), READY, groups), { type: 'TICK', ms: 1000 }, groups);
    const buffering = reduce(st, { type: 'MEDIA_LOADING' }, groups);
    expect(transitionEvents(buffering, reduce(buffering, READY, groups), groups)).toEqual([]);
  });

  it('only counts a completion when the last story was shown', () => {
    let st = reduce(openViewer(groups, 1), { type: 'MEDIA_READY', failed: true }, groups);
    expect(transitionEvents(st, reduce(st, { type: 'NEXT' }, groups), groups)).toEqual([]);
    st = reduce(openViewer(groups, 1), READY, groups);
    expect(transitionEvents(st, reduce(st, { type: 'NEXT' }, groups), groups)).toEqual([
      { type: 'group_complete', groupId: 'B' },
    ]);
  });

  it('does not report anything for timer ticks or pauses', () => {
    const st = reduce(openViewer(groups, 0), { type: 'MEDIA_READY' }, groups);
    for (const a of [{ type: 'TICK', ms: 100 }, { type: 'PAUSE' }] as const) {
      expect(transitionEvents(st, reduce(st, a, groups), groups)).toEqual([]);
    }
  });
});

describe('actionEvents', () => {
  const st = openViewer(groups, 0);
  const g = groups[0]!;
  const on = { groupId: g.id, storyId: g.stories[0]!.id };

  it('counts taps, skips and exits against the story they came from', () => {
    expect(actionEvents(st, { type: 'NEXT' }, groups)).toEqual([{ type: 'tap_forward', ...on }]);
    expect(actionEvents(st, { type: 'PREV' }, groups)).toEqual([{ type: 'tap_back', ...on }]);
    expect(actionEvents(st, { type: 'NEXT_GROUP' }, groups)).toEqual([
      { type: 'group_skip', ...on },
    ]);
    expect(actionEvents(st, { type: 'CLOSE' }, groups)).toEqual([{ type: 'exit', ...on }]);
  });

  it('ignores stories ending by themselves, timers and a closed viewer', () => {
    expect(actionEvents(st, { type: 'NEXT', auto: true }, groups)).toEqual([]);
    expect(actionEvents(st, { type: 'TICK', ms: 5000 }, groups)).toEqual([]);
    expect(actionEvents(st, { type: 'PREV_GROUP' }, groups)).toEqual([]);
    expect(actionEvents(CLOSED, { type: 'CLOSE' }, groups)).toEqual([]);
  });
});

describe('AnalyticsQueue', () => {
  afterEach(() => vi.useRealTimers());

  function setup(overrides: Partial<ConstructorParameters<typeof AnalyticsQueue>[0]> = {}) {
    const sent: { body: any; beacon: boolean }[] = [];
    let fail = false;
    const transport: Transport = {
      send: vi.fn(async (_url, body, { beacon }) => {
        if (fail) throw new Error('offline');
        sent.push({ body: JSON.parse(body), beacon });
      }),
    };
    const q = new AnalyticsQueue({
      url: 'https://api/v1/events?token=t',
      sdk: 'test@1',
      transport,
      now: () => 42,
      sessionId: 'sess',
      ...overrides,
    });
    return { q, sent, transport, setFail: (v: boolean) => (fail = v) };
  }

  it('batches events and flushes after the interval', async () => {
    vi.useFakeTimers();
    const { q, sent } = setup();
    q.track({ type: 'impression', groupId: 'A' });
    q.track({ type: 'group_open', groupId: 'A' });
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({
      sdk: 'test@1',
      sessionId: 'sess',
      events: [
        { type: 'impression', groupId: 'A', ts: 42 },
        { type: 'group_open', groupId: 'A', ts: 42 },
      ],
    });
  });

  it('flushes immediately when a batch is full, in chunks of maxBatch', async () => {
    const { q, sent } = setup({ maxBatch: 2 });
    q.track({ type: 'impression', groupId: 'A' });
    q.track({ type: 'impression', groupId: 'B' });
    await Promise.resolve();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.events).toHaveLength(2);
  });

  it('keeps events after a failed send and retries later', async () => {
    const { q, sent, setFail } = setup();
    setFail(true);
    q.track({ type: 'impression', groupId: 'A' });
    await q.flush();
    expect(q.pending).toBe(1);
    setFail(false);
    await q.flush();
    expect(sent).toHaveLength(1);
    expect(q.pending).toBe(0);
  });

  it('uses the beacon path on dispose', async () => {
    const { q, sent } = setup();
    q.track({ type: 'cta_click', groupId: 'A', storyId: 'a1' });
    q.dispose();
    await Promise.resolve();
    expect(sent[0]!.beacon).toBe(true);
  });

  it('caps the queue while offline', async () => {
    const { q, setFail } = setup({ maxQueue: 3, maxBatch: 100 });
    setFail(true);
    for (let i = 0; i < 10; i++) q.track({ type: 'impression', groupId: `g${i}` });
    expect(q.pending).toBe(3);
  });
});

describe('SeenStore', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const data = { ...initial };
    return {
      data,
      getItem: (k: string) => data[k] ?? null,
      setItem: (k: string, v: string) => {
        data[k] = v;
      },
    };
  }

  it('persists seen ids per app and reports group seen state', async () => {
    const storage = memoryStorage();
    const seen = new SeenStore(storage, 'app1');
    await seen.load();
    expect(seen.isGroupSeen(groups[0]!)).toBe(false);
    seen.markSeen('a1');
    expect(seen.firstUnseenIndex(groups[0]!)).toBe(1);
    seen.markSeen('a2');
    expect(seen.isGroupSeen(groups[0]!)).toBe(true);
    expect(seen.firstUnseenIndex(groups[0]!)).toBe(0);

    const reloaded = new SeenStore(storage, 'app1');
    await reloaded.load();
    expect(reloaded.isGroupSeen(groups[0]!)).toBe(true);
    const otherApp = new SeenStore(storage, 'app2');
    await otherApp.load();
    expect(otherApp.has('a1')).toBe(false);
  });

  it('marks a group unseen again when a new story is added', async () => {
    const seen = new SeenStore(memoryStorage(), 'app');
    seen.markSeen('b1');
    expect(seen.isGroupSeen(groups[1]!)).toBe(true);
    const updated = { id: 'B', stories: [...groups[1]!.stories, { id: 'b2', durationMs: 1 }] };
    expect(seen.isGroupSeen(updated)).toBe(false);
  });

  it('survives broken or unavailable storage', async () => {
    const corrupt = new SeenStore(memoryStorage({ 'stories:seen:app': '{not json' }), 'app');
    await corrupt.load();
    expect(corrupt.has('x')).toBe(false);

    const throwing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceeded');
      },
    };
    const seen = new SeenStore(throwing, 'app');
    await seen.load();
    expect(() => seen.markSeen('a1')).not.toThrow();
    expect(seen.has('a1')).toBe(true);
  });
});

describe('fetchFeed', () => {
  const response = (status: number, body?: unknown) =>
    Promise.resolve(new Response(body === undefined ? null : JSON.stringify(body), { status }));

  it('maps HTTP errors to StoriesError codes', async () => {
    const cases: [number, string][] = [
      [401, 'invalid_token'],
      [403, 'origin_not_allowed'],
      [500, 'server'],
    ];
    for (const [status, code] of cases) {
      const err = await fetchFeed({
        apiUrl: 'x',
        token: 't',
        fetch: () => response(status, {}),
      }).catch((e) => e);
      expect(err).toBeInstanceOf(StoriesError);
      expect(err.code).toBe(code);
    }
    const net = await fetchFeed({
      apiUrl: 'x',
      token: 't',
      fetch: () => Promise.reject(new TypeError('Failed to fetch')),
    }).catch((e) => e);
    expect(net.code).toBe('network');
  });

  it('asks for a story bar by key and explains an unknown one', async () => {
    let calledWith = '';
    const feed = await fetchFeed({
      apiUrl: 'https://api.example.com',
      token: 'pk_live_x',
      bar: 'product page',
      fetch: (url) => {
        calledWith = String(url);
        return response(200, {
          app: { id: 'app', deepLinkSchemes: [] },
          bar: { id: 'b1', key: 'product-page' },
          groups: [],
        });
      },
    });
    expect(calledWith).toBe('https://api.example.com/v1/feed?token=pk_live_x&bar=product%20page');
    expect(feed.bar).toEqual({ id: 'b1', key: 'product-page' });

    const err = await fetchFeed({
      apiUrl: 'x',
      token: 't',
      bar: 'nope',
      fetch: () => response(404, {}),
    }).catch((e) => e);
    expect(err.code).toBe('unknown_bar');
    expect(err.message).toContain('nope');
  });

  it('sends the viewer’s tags normalised, so the same person gets the same cached feed', async () => {
    let calledWith = '';
    await fetchFeed({
      apiUrl: 'https://api.example.com',
      token: 'pk_live_x',
      tags: ['Premium', ' london ', 'london', 'not valid!'],
      fetch: (url) => {
        calledWith = String(url);
        return response(200, { app: { id: 'app', deepLinkSchemes: [] }, groups: [] });
      },
    });
    expect(calledWith).toBe(
      'https://api.example.com/v1/feed?token=pk_live_x&tags=london%2Cpremium',
    );
  });

  it('builds the URL and drops malformed groups and stories', async () => {
    let calledWith = '';
    const feed = await fetchFeed({
      apiUrl: 'https://api.example.com/',
      token: 'pk_live_x',
      fetch: (url) => {
        calledWith = String(url);
        return response(200, {
          app: { id: 'app', deepLinkSchemes: ['demo'] },
          groups: [
            {
              id: 'g1',
              title: 'ok',
              coverUrl: 'c',
              updatedAt: '',
              stories: [{ id: 's', type: 'image', url: 'u', durationMs: 5000 }],
            },
            {
              id: 'g2',
              title: 'only bad stories',
              stories: [{ id: 's2', type: 'gif', url: 'u', durationMs: 1 }],
            },
            null,
          ],
        });
      },
    });
    expect(calledWith).toBe('https://api.example.com/v1/feed?token=pk_live_x');
    expect(feed.groups.map((g) => g.id)).toEqual(['g1']);
  });

  it('keeps the sharing flag (off unless the server says true)', () => {
    const base = { app: { id: 'a', deepLinkSchemes: [] }, groups: [] };
    expect(normalizeFeed(base).app.sharing).toBe(false);
    expect(normalizeFeed({ ...base, app: { ...base.app, sharing: true } }).app.sharing).toBe(true);
    expect(normalizeFeed({ ...base, app: { ...base.app, sharing: 'yes' } }).app.sharing).toBe(
      false,
    );
  });

  it('keeps the dashboard bar layout, clamped to safe values', () => {
    const base = { app: { id: 'a', deepLinkSchemes: [] }, groups: [] };
    expect(normalizeFeed(base).app.layout).toBeUndefined();
    const layout = { width: 72, height: 112, corner: 16, gap: 10 };
    expect(normalizeFeed({ ...base, app: { ...base.app, layout } }).app.layout).toEqual(layout);
    expect(
      normalizeFeed({ ...base, app: { ...base.app, layout: { width: 9999, corner: 'x' } } }).app
        .layout,
    ).toEqual({ width: 160, height: 68, corner: 50, gap: 14 });
  });

  it('rejects completely unexpected payloads', () => {
    expect(() => normalizeFeed({ nope: true })).toThrow(StoriesError);
  });
});

describe('resolveTheme', () => {
  it('merges over defaults and clamps unreasonable values', () => {
    const t = resolveTheme({
      circleSize: 5000,
      ringColors: [],
      gap: Number.NaN,
      titleColor: 'red',
    });
    expect(t.circleSize).toBe(160);
    expect(t.ringColors.length).toBeGreaterThan(0);
    expect(t.gap).toBe(14);
    expect(t.titleColor).toBe('red');
  });
});

describe('anonymous viewer ID', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it('is made once and kept, then replaced after 13 months', async () => {
    const { loadViewerId, VIEWER_ID_MAX_AGE_MS } = await import('../src/viewer.js');
    const storage = memory();
    const first = await loadViewerId(storage, 1_000);
    expect(first).toMatch(/\w{8,}/);
    expect(await loadViewerId(storage, 1_000 + VIEWER_ID_MAX_AGE_MS - 1)).toBe(first);
    expect(await loadViewerId(storage, 1_000 + VIEWER_ID_MAX_AGE_MS)).not.toBe(first);
  });

  it('is forgotten on request, and absent without storage', async () => {
    const { clearViewerId, loadViewerId } = await import('../src/viewer.js');
    const storage = memory();
    const first = await loadViewerId(storage);
    await clearViewerId(storage);
    expect(await loadViewerId(storage)).not.toBe(first);
    expect(await loadViewerId(null)).toBeNull();
  });

  it('is sent with each analytics batch', async () => {
    const sent: string[] = [];
    const q = new AnalyticsQueue({
      url: 'https://api.test/v1/events',
      sdk: 'test',
      transport: { send: async (_u, body) => void sent.push(body) },
      viewer: () => 'viewer-123',
    });
    q.track({ type: 'impression', groupId: 'A' });
    await q.flush();
    expect(JSON.parse(sent[0]!)).toMatchObject({ viewer: 'viewer-123' });
  });
});
