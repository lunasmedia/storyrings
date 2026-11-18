import type { FeedGroupDto } from '@stories/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EnergizedBar } from '../src/energized.js';

const story = (id: string, type: 'image' | 'video' = 'image') => ({
  id,
  type,
  url: `https://cdn.test/${id}.${type === 'image' ? 'png' : 'mp4'}`,
  durationMs: 5000,
  width: 1080,
  height: 1920,
  alt: '',
  cta: null,
});
const group = (id: string, ...stories: ReturnType<typeof story>[]): FeedGroupDto => ({
  id,
  title: id,
  coverUrl: `https://cdn.test/${id}-cover.jpg`,
  updatedAt: '',
  stories,
});

/** Cards report themselves fully visible (or not) when told to. */
let observed: { el: Element; cb: IntersectionObserverCallback }[] = [];
class FakeObserver {
  constructor(private readonly cb: IntersectionObserverCallback) {}
  observe(el: Element) {
    observed.push({ el, cb: this.cb });
  }
  disconnect() {
    observed = observed.filter((o) => o.cb !== this.cb);
  }
  unobserve() {}
}
function showCards(visible: number[]) {
  for (const [i, o] of observed.entries()) {
    const on = visible.includes(i);
    o.cb(
      [{ target: o.el, isIntersecting: on, intersectionRatio: on ? 1 : 0 } as never],
      o as never,
    );
  }
}

function bar(groups: FeedGroupDto[]) {
  const list = document.createElement('ul');
  for (const g of groups) {
    const li = document.createElement('li');
    li.dataset.group = g.id;
    li.innerHTML = '<span class="img"><img class="cover"></span>';
    list.append(li);
  }
  document.body.append(list);
  const energized = new EnergizedBar();
  energized.start(list, groups);
  /** Which card shows a preview, and of which story. */
  const previewing = () =>
    [...list.querySelectorAll('.ep')].map((ep) => ({
      group: (ep.closest('li') as HTMLElement).dataset.group,
      src: ep.querySelector('img, video')?.getAttribute('src'),
    }));
  return { list, energized, previewing };
}

describe('Energized style (web)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    observed = [];
    vi.stubGlobal('IntersectionObserver', FakeObserver);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('previews each card’s first story for 7 seconds in turn, off screen too, then loops', async () => {
    const { previewing } = bar([
      group('a', story('a1'), story('a2')),
      group('b', story('b1', 'video')),
      group('c', story('c1')),
    ]);
    showCards([0, 1]);
    await vi.advanceTimersByTimeAsync(150);
    // Only ever the group's first story, not its later ones.
    expect(previewing()).toEqual([{ group: 'a', src: 'https://cdn.test/a1.png' }]);

    await vi.advanceTimersByTimeAsync(7000);
    // The previous preview fades out, then is removed.
    await vi.advanceTimersByTimeAsync(300);
    expect(previewing()).toEqual([{ group: 'b', src: 'https://cdn.test/b1.mp4' }]);
    const video = document.querySelector('.ep video') as HTMLVideoElement;
    expect(video.muted).toBe(true);

    // The card off screen takes its turn too (the bar scrolls to it).
    await vi.advanceTimersByTimeAsync(7300);
    expect(previewing()).toEqual([{ group: 'c', src: 'https://cdn.test/c1.png' }]);

    await vi.advanceTimersByTimeAsync(7300);
    expect(previewing()).toEqual([{ group: 'a', src: 'https://cdn.test/a1.png' }]);
  });

  it('scrolls the bar to the card whose turn it is, and hides its circle while it shows', async () => {
    const groups = [group('a', story('a1')), group('b', story('b1'))];
    const { list } = bar(groups);
    const scroller = document.createElement('div');
    scroller.append(list);
    document.body.append(scroller);
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy as never;
    scroller.getBoundingClientRect = () => ({ left: 0, right: 200 }) as DOMRect;
    const [a, b] = [...list.children] as [HTMLElement, HTMLElement];
    a.getBoundingClientRect = () => ({ left: 10, right: 90 }) as DOMRect;
    b.getBoundingClientRect = () => ({ left: 150, right: 230 }) as DOMRect;
    for (const li of [a, b])
      li.innerHTML = '<span class="card"><span class="card-bg"></span></span>';

    showCards([0]);
    await vi.advanceTimersByTimeAsync(150);
    // Already on screen: no scrolling.
    expect(scrollBy).not.toHaveBeenCalled();
    const img = a.querySelector('.ep img') as HTMLImageElement;
    expect(a.querySelector('.card')?.classList.contains('previewing')).toBe(false);
    img.dispatchEvent(new Event('load'));
    expect(a.querySelector('.card')?.classList.contains('previewing')).toBe(true);

    await vi.advanceTimersByTimeAsync(7000);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 30 }));
    // The circle comes back on the card whose turn is over.
    expect(a.querySelector('.card')?.classList.contains('previewing')).toBe(false);
    // Loading after its turn is over doesn't hide it again.
    img.dispatchEvent(new Event('load'));
    expect(a.querySelector('.card')?.classList.contains('previewing')).toBe(false);
  });

  it('starts again from the first visible card after scrolling the one previewing away', async () => {
    const { previewing } = bar([
      group('a', story('a1')),
      group('b', story('b1')),
      group('c', story('c1')),
      group('d', story('d1')),
    ]);
    showCards([0, 1]);
    await vi.advanceTimersByTimeAsync(7150 + 300);
    expect(previewing()[0]?.group).toBe('b');
    // Still on screen: it carries on.
    showCards([1, 2]);
    await vi.advanceTimersByTimeAsync(150 + 300);
    expect(previewing()).toEqual([{ group: 'b', src: 'https://cdn.test/b1.png' }]);
    // Scrolled away: the first visible card starts.
    showCards([2, 3]);
    await vi.advanceTimersByTimeAsync(150 + 300);
    expect(previewing()).toEqual([{ group: 'c', src: 'https://cdn.test/c1.png' }]);
    await vi.advanceTimersByTimeAsync(7000 + 300);
    expect(previewing()[0]?.group).toBe('d');
  });

  it('carries on where it was when the bar is redrawn with the same stories', async () => {
    const groups = [group('a', story('a1')), group('b', story('b1')), group('c', story('c1'))];
    const { energized } = bar(groups);
    showCards([0, 1, 2]);
    await vi.advanceTimersByTimeAsync(150 + 7000 + 300);
    // The viewer opens (previews pause), closes, and the bar is redrawn.
    energized.hold(true);
    await vi.advanceTimersByTimeAsync(5000);
    energized.hold(false);
    const redrawn = document.createElement('ul');
    for (const g of groups) {
      const li = document.createElement('li');
      li.dataset.group = g.id;
      li.innerHTML = '<span class="img"><img class="cover"></span>';
      redrawn.append(li);
    }
    document.body.replaceChildren(redrawn);
    observed = [];
    energized.start(
      redrawn,
      groups.map((g) => ({ ...g })),
    );
    showCards([0, 1, 2]);
    await vi.advanceTimersByTimeAsync(150);
    const previewing = () =>
      [...redrawn.querySelectorAll('.ep')].map(
        (ep) => (ep.closest('li') as HTMLElement).dataset.group,
      );
    // Still the second card (not back to the first), and then on to the third.
    expect(previewing()).toEqual(['b']);
    await vi.advanceTimersByTimeAsync(7000 + 300);
    expect(previewing()).toEqual(['c']);
  });

  it('starts again for a new feed', async () => {
    const { energized } = bar([group('a', story('a1')), group('b', story('b1'))]);
    showCards([0, 1]);
    await vi.advanceTimersByTimeAsync(150 + 7000 + 300);
    const list = document.createElement('ul');
    for (const id of ['a', 'b']) {
      const li = document.createElement('li');
      li.dataset.group = id;
      li.innerHTML = '<span class="img"><img class="cover"></span>';
      list.append(li);
    }
    document.body.replaceChildren(list);
    observed = [];
    energized.start(list, [group('a', story('a2')), group('b', story('b1'))]);
    showCards([0, 1]);
    await vi.advanceTimersByTimeAsync(150);
    expect(list.querySelector('.ep')?.closest('li')?.dataset.group).toBe('a');
  });

  it('keeps the preview paused in place while held (the viewer opened from it), and none after stopping', async () => {
    const { energized, previewing, list } = bar([group('a', story('a1'))]);
    showCards([0]);
    await vi.advanceTimersByTimeAsync(150);
    expect(previewing()).toHaveLength(1);
    const layer = list.querySelector('.ep')!;
    const zoom = () => layer.querySelector<HTMLElement>('.zoom')!.style.animationPlayState;
    energized.hold(true);
    await vi.advanceTimersByTimeAsync(300);
    // Still there (the circle stays aside as the viewer grows out of the card), and paused.
    expect([...list.querySelectorAll('.ep')]).toEqual([layer]);
    expect(zoom()).toBe('paused');
    energized.hold(false);
    // Carries on where it was.
    expect([...list.querySelectorAll('.ep')]).toEqual([layer]);
    expect(zoom()).toBe('');
    energized.stop();
    await vi.advanceTimersByTimeAsync(300);
    expect(previewing()).toHaveLength(0);
  });
});
