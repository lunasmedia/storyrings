import { describe, expect, it } from 'vitest';
import {
  CLOSED,
  type GroupLike,
  openViewer,
  progressSegments,
  reduce,
  type ViewerAction,
  type ViewerState,
} from '../src/machine.js';

// Three groups: A has 3 stories, B has 1, C has 2.
const groups: GroupLike[] = [
  { id: 'A', stories: [s('a1'), s('a2'), s('a3')] },
  { id: 'B', stories: [s('b1')] },
  { id: 'C', stories: [s('c1', 8000), s('c2')] },
];

function s(id: string, durationMs = 5000) {
  return { id, durationMs };
}

/** Applies actions in order; MEDIA_READY is sent after every navigation like a real renderer. */
function run(state: ViewerState, ...actions: ViewerAction[]): ViewerState {
  return actions.reduce((st, a) => reduce(st, a, groups), state);
}

const at = (st: ViewerState) =>
  st.open ? `${groups[st.groupIndex]!.stories[st.storyIndex]!.id}` : 'closed';
const ready = (st: ViewerState) => reduce(st, { type: 'MEDIA_READY' }, groups);

describe('openViewer', () => {
  it('opens at the first story of the chosen group, buffering until media is ready', () => {
    const st = openViewer(groups, 2);
    expect(at(st)).toBe('c1');
    expect(st).toMatchObject({
      open: true,
      elapsedMs: 0,
      durationMs: 8000,
      buffering: true,
      paused: false,
    });
  });

  it('can resume at a given story (e.g. first unseen)', () => {
    expect(at(openViewer(groups, 0, { startStoryIndex: () => 2 }))).toBe('a3');
    // Out-of-range start indexes fall back to 0.
    expect(at(openViewer(groups, 0, { startStoryIndex: () => 9 }))).toBe('a1');
  });

  it('stays closed for missing or empty groups', () => {
    expect(openViewer(groups, 7)).toBe(CLOSED);
    expect(openViewer([{ id: 'x', stories: [] }], 0)).toBe(CLOSED);
  });
});

describe('tap navigation (NEXT / PREV)', () => {
  it('walks forward through stories and across groups, then closes as completed', () => {
    const path: string[] = [];
    let st = openViewer(groups, 0);
    while (st.open) {
      path.push(at(st));
      st = run(st, { type: 'NEXT' });
    }
    expect(path).toEqual(['a1', 'a2', 'a3', 'b1', 'c1', 'c2']);
    expect(st.closeReason).toBe('completed');
  });

  it('goes back within a group, then to the previous group’s last story', () => {
    let st = openViewer(groups, 2); // c1
    st = run(st, { type: 'PREV' });
    expect(at(st)).toBe('b1');
    st = run(st, { type: 'PREV' });
    expect(at(st)).toBe('a3');
    st = run(st, { type: 'PREV' });
    expect(at(st)).toBe('a2');
  });

  it('restarts the very first story instead of closing', () => {
    let st = ready(openViewer(groups, 0));
    st = run(st, { type: 'TICK', ms: 3000 });
    const restarted = run(st, { type: 'PREV' });
    expect(at(restarted)).toBe('a1');
    expect(restarted.elapsedMs).toBe(0);
    expect(restarted.seq).toBe(st.seq + 1);
    expect(restarted.open).toBe(true);
  });

  it('enters later groups at their start story when moving forward', () => {
    const opts = { startStoryIndex: (g: number) => (g === 2 ? 1 : 0) };
    let st = openViewer(groups, 1, opts);
    st = reduce(st, { type: 'NEXT' }, groups, opts);
    expect(at(st)).toBe('c2');
  });

  it('increments seq on every story start so renderers know to load media', () => {
    let st = openViewer(groups, 0);
    const seqs = [st.seq];
    for (const a of ['NEXT', 'NEXT', 'PREV'] as const) {
      st = run(st, { type: a });
      seqs.push(st.seq);
    }
    expect(seqs).toEqual([1, 2, 3, 4]);
  });
});

describe('swipe navigation (NEXT_GROUP / PREV_GROUP)', () => {
  it('jumps to the next group from any story', () => {
    const st = run(openViewer(groups, 0), { type: 'NEXT' }, { type: 'NEXT_GROUP' });
    expect(at(st)).toBe('b1');
  });

  it('closes as completed when swiping past the last group', () => {
    const st = run(openViewer(groups, 2), { type: 'NEXT_GROUP' });
    expect(st).toMatchObject({ open: false, closeReason: 'completed' });
  });

  it('goes to the previous group’s first story, or restarts the first group', () => {
    expect(at(run(openViewer(groups, 2), { type: 'NEXT' }, { type: 'PREV_GROUP' }))).toBe('b1');
    expect(at(run(openViewer(groups, 0), { type: 'NEXT' }, { type: 'PREV_GROUP' }))).toBe('a1');
  });
});

describe('timer (TICK)', () => {
  it('does not advance while media is buffering', () => {
    const st = run(openViewer(groups, 0), { type: 'TICK', ms: 10_000 });
    expect(at(st)).toBe('a1');
    expect(st.elapsedMs).toBe(0);
  });

  it('accumulates time and auto-advances when the duration is reached', () => {
    let st = ready(openViewer(groups, 0));
    st = run(st, { type: 'TICK', ms: 2000 }, { type: 'TICK', ms: 2000 });
    expect(st.elapsedMs).toBe(4000);
    st = run(st, { type: 'TICK', ms: 1000 });
    expect(at(st)).toBe('a2');
    expect(st.elapsedMs).toBe(0);
    expect(st.buffering).toBe(true);
  });

  it('ignores zero and negative ticks', () => {
    const st = ready(openViewer(groups, 0));
    expect(run(st, { type: 'TICK', ms: 0 })).toBe(st);
    expect(run(st, { type: 'TICK', ms: -50 })).toBe(st);
  });

  it('closes as completed after the last story times out', () => {
    let st = ready(openViewer(groups, 2, { startStoryIndex: () => 1 }));
    st = run(st, { type: 'TICK', ms: 5000 }, { type: 'TICK', ms: 16 });
    expect(st).toMatchObject({ open: false, closeReason: 'completed' });
  });
});

describe('pause / resume (hold, pause button, hidden tab)', () => {
  it('freezes the timer while paused', () => {
    let st = ready(openViewer(groups, 0));
    st = run(st, { type: 'TICK', ms: 1000 }, { type: 'PAUSE' }, { type: 'TICK', ms: 9000 });
    expect(st).toMatchObject({ paused: true, elapsedMs: 1000 });
    st = run(st, { type: 'RESUME' }, { type: 'TICK', ms: 500 });
    expect(st).toMatchObject({ paused: false, elapsedMs: 1500 });
  });

  it('returns the same object for no-op pause/resume', () => {
    const st = ready(openViewer(groups, 0));
    expect(run(st, { type: 'RESUME' })).toBe(st);
    const paused = run(st, { type: 'PAUSE' });
    expect(run(paused, { type: 'PAUSE' })).toBe(paused);
  });

  it('clears pause when the user navigates', () => {
    const st = run(ready(openViewer(groups, 0)), { type: 'PAUSE' }, { type: 'NEXT' });
    expect(st.paused).toBe(false);
  });
});

describe('media events', () => {
  it('uses the real video duration when the media reports one', () => {
    const st = reduce(openViewer(groups, 0), { type: 'MEDIA_READY', durationMs: 7300 }, groups);
    expect(st).toMatchObject({ buffering: false, durationMs: 7300 });
  });

  it('ignores invalid reported durations', () => {
    for (const d of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const st = reduce(openViewer(groups, 0), { type: 'MEDIA_READY', durationMs: d }, groups);
      expect(st.durationMs).toBe(5000);
    }
  });

  it('stops the timer again on MEDIA_LOADING (video stalls)', () => {
    let st = ready(openViewer(groups, 0));
    st = run(st, { type: 'TICK', ms: 1000 }, { type: 'MEDIA_LOADING' }, { type: 'TICK', ms: 3000 });
    expect(st).toMatchObject({ buffering: true, elapsedMs: 1000 });
  });
});

describe('closing', () => {
  it('closes with reason "user" and ignores further actions', () => {
    const st = run(openViewer(groups, 1), { type: 'CLOSE' });
    expect(st).toMatchObject({ open: false, closeReason: 'user' });
    expect(run(st, { type: 'NEXT' })).toBe(st);
    expect(run(st, { type: 'TICK', ms: 99_999 })).toBe(st);
  });

  it('handles the feed shrinking under an open viewer', () => {
    const st = openViewer(groups, 2);
    expect(reduce(st, { type: 'NEXT' }, groups.slice(0, 1))).toMatchObject({ open: false });
  });
});

describe('progressSegments', () => {
  it('fills previous stories, partially fills the current one', () => {
    let st = ready(openViewer(groups, 0));
    st = run(st, { type: 'NEXT' });
    st = ready(st);
    st = run(st, { type: 'TICK', ms: 1250 });
    expect(progressSegments(st, groups)).toEqual([1, 0.25, 0]);
  });

  it('is empty when closed', () => {
    expect(progressSegments(CLOSED, groups)).toEqual([]);
  });
});

describe('viewability (MRC/IAB: images 1 s on screen, videos 2 s of playback)', () => {
  const media: GroupLike[] = [
    {
      id: 'M',
      stories: [
        { id: 'img', durationMs: 5000, type: 'image' },
        { id: 'vid', durationMs: 6000, type: 'video' },
      ],
    },
  ];
  const step = (st: ViewerState, ...actions: ViewerAction[]) =>
    actions.reduce((acc, a) => reduce(acc, a, media), st);
  const tick = (ms: number): ViewerAction => ({ type: 'TICK', ms });
  const READY: ViewerAction = { type: 'MEDIA_READY' };
  const image = () => step(openViewer(media, 0), READY);
  const video = () => step(openViewer(media, 0), READY, { type: 'NEXT' }, READY);

  it('needs an image on screen for one continuous second, counted from when it rendered', () => {
    expect(step(openViewer(media, 0), tick(3000)).viewed).toBe(false); // never rendered
    expect(step(image(), tick(999)).viewed).toBe(false);
    expect(step(image(), tick(500), tick(500)).viewed).toBe(true);
  });

  it('keeps counting while an image is held paused, since it stays on screen', () => {
    expect(step(image(), tick(400), { type: 'PAUSE' }, tick(600)).viewed).toBe(true);
  });

  it('restarts the count when the viewer goes off screen', () => {
    // Renderers pause and hide together when the tab or app goes to the background.
    const st = step(
      image(),
      tick(800),
      { type: 'HIDE' },
      { type: 'PAUSE' },
      tick(5000),
      { type: 'SHOW' },
      { type: 'RESUME' },
    );
    expect(st.viewed).toBe(false);
    expect(step(st, tick(999)).viewed).toBe(false);
    expect(step(st, tick(1000)).viewed).toBe(true);
  });

  it('needs two seconds of continuous video playback', () => {
    expect(step(video(), tick(1999)).viewed).toBe(false);
    expect(step(video(), tick(1000), tick(1000)).viewed).toBe(true);
    // Pausing or buffering breaks the continuous playback; the count starts again.
    const paused = step(video(), tick(1500), { type: 'PAUSE' }, tick(5000), { type: 'RESUME' });
    expect(step(paused, tick(1999)).viewed).toBe(false);
    expect(step(paused, tick(2000)).viewed).toBe(true);
    const buffered = step(video(), tick(1500), { type: 'MEDIA_LOADING' }, READY, tick(1000));
    expect(buffered.viewed).toBe(false);
  });

  it('keeps a story viewed once it qualified', () => {
    const st = step(image(), tick(1000), { type: 'HIDE' }, { type: 'SHOW' }, { type: 'PAUSE' });
    expect(st.viewed).toBe(true);
  });

  it('reports the view before moving on when a story ends as it qualifies', () => {
    const short: GroupLike[] = [{ id: 'S', stories: [{ id: 's', durationMs: 1000 }] }];
    let st = reduce(openViewer(short, 0), READY, short);
    st = reduce(st, tick(1000), short);
    expect(st).toMatchObject({ open: true, viewed: true });
    expect(reduce(st, tick(16), short)).toMatchObject({ open: false, closeReason: 'completed' });
  });
});
