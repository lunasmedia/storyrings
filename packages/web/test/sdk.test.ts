import type { FeedDto } from '@stories/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineStoriesElement, init, type StoriesClient } from '../src/index.js';
import { loadViewer } from '../src/load-viewer.js';

const feed: FeedDto = {
  app: { id: 'app1', deepLinkSchemes: ['demo'] },
  groups: [
    {
      id: 'gA',
      title: 'New in',
      coverUrl: 'https://cdn.test/a.png',
      updatedAt: '',
      stories: [
        {
          id: 'a1',
          type: 'image',
          url: 'https://cdn.test/a1.png',
          durationMs: 5000,
          width: 1,
          height: 1,
          alt: 'Red jacket',
          cta: null,
        },
        {
          id: 'a2',
          type: 'image',
          url: 'https://cdn.test/a2.png',
          durationMs: 5000,
          width: 1,
          height: 1,
          alt: 'Blue scarf',
          cta: { label: 'Shop now', url: 'demo://product/2' },
        },
      ],
    },
    {
      id: 'gB',
      title: 'Sale',
      coverUrl: 'https://cdn.test/b.png',
      updatedAt: '',
      stories: [
        {
          id: 'b1',
          type: 'image',
          url: 'https://cdn.test/b1.png',
          durationMs: 5000,
          width: 1,
          height: 1,
          alt: 'Sale',
          cta: { label: 'Bad', url: 'javascript:alert(1)' },
        },
      ],
    },
  ],
};

let fetchMock: ReturnType<typeof vi.fn>;
let client: StoriesClient | null = null;

function memoryStorage() {
  const data: Record<string, string> = {};
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

// The viewer is loaded on demand (see lazy.test.ts); here it's ready, as after a hover.
beforeAll(async () => {
  await loadViewer();
});

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) =>
    String(url).includes('/v1/feed')
      ? new Response(JSON.stringify(feed), { status: 200 })
      : new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  HTMLMediaElement.prototype.play = vi.fn(() => Promise.resolve());
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  document.body.innerHTML = '<div id="stories"></div>';
});

afterEach(() => {
  client?.destroy();
  client = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function mountBar(options: Parameters<StoriesClient['mount']>[1] = {}) {
  client = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage: memoryStorage() });
  const onLoad = vi.fn();
  const handle = client.mount('#stories', { onLoad, ...options });
  await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
  const bar = document.querySelector<HTMLElement>('[data-stories-bar]')!.shadowRoot!;
  return { handle, bar, onLoad };
}

const viewerRoot = () => document.querySelector('[data-stories-viewer]')?.shadowRoot ?? null;
const dialog = () => viewerRoot()?.querySelector<HTMLElement>('[role="dialog"]') ?? null;
const live = () => viewerRoot()?.querySelector('[aria-live]')?.textContent;
const key = (k: string, extra: KeyboardEventInit = {}) =>
  dialog()!.dispatchEvent(
    new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true, ...extra }),
  );
const circles = (bar: ShadowRoot) => [...bar.querySelectorAll<HTMLButtonElement>('button.item')];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const loadImage = () => viewerRoot()!.querySelector('.media img')!.dispatchEvent(new Event('load'));

describe('story bar', () => {
  it('fetches the feed for the token and renders labelled circle buttons', async () => {
    const { bar, onLoad } = await mountBar();
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/feed?token=pk_live_test',
      expect.anything(),
    );
    expect(onLoad).toHaveBeenCalledWith(feed.groups);
    expect(bar.querySelector('ul')!.getAttribute('aria-label')).toBe('Stories');
    expect(circles(bar).map((b) => b.getAttribute('aria-label'))).toEqual([
      'New in, 2 stories',
      'Sale, 1 story',
    ]);
    expect(bar.querySelector('.title')!.textContent).toBe('New in');
  });

  it('holds the space with the remembered feed on the next page load, and shows the live one', async () => {
    const storage = memoryStorage();
    const first = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage });
    const loaded = vi.fn();
    first.mount('#stories', { onLoad: loaded });
    await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
    first.destroy();

    // Next page load: the network is slow.
    let answer: (r: Response) => void = () => {};
    fetchMock.mockImplementation((url: string) =>
      String(url).includes('/v1/feed')
        ? new Promise<Response>((r) => {
            answer = r;
          })
        : Promise.resolve(new Response(null, { status: 204 })),
    );
    client = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage });
    const track = vi.spyOn(client, 'track');
    const onLoad = vi.fn();
    client.mount('#stories', { onLoad });
    await Promise.resolve();
    const bar = document.querySelector<HTMLElement>('[data-stories-bar]')!.shadowRoot!;
    // The remembered circles take their space straight away, but stay hidden
    // while the live feed is on its way; they don't count as impressions.
    const wrapper = bar.querySelector('.bar')!;
    await vi.waitFor(() => expect(circles(bar)).toHaveLength(2));
    expect(bar.querySelector('.skeleton')).toBeNull();
    expect(wrapper.classList.contains('pending')).toBe(true);
    expect(onLoad).not.toHaveBeenCalled();
    expect(track).not.toHaveBeenCalled();

    // The live feed arrives with a change: the bar follows it.
    const changed = { ...feed, groups: [{ ...feed.groups[0]!, title: 'Breaking' }] };
    answer(new Response(JSON.stringify(changed), { status: 200 }));
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
    expect(circles(bar).map((b) => b.getAttribute('aria-label'))).toEqual(['Breaking, 2 stories']);
    expect(wrapper.classList.contains('pending')).toBe(false);
    await vi.waitFor(
      () => expect(track).toHaveBeenCalledWith({ type: 'impression', groupId: 'gA' }),
      { timeout: 2000 },
    );
  });

  it('shows the remembered feed if the network is slow', async () => {
    const storage = memoryStorage();
    const first = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage });
    const loaded = vi.fn();
    first.mount('#stories', { onLoad: loaded });
    await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
    first.destroy();

    fetchMock.mockImplementation(() => new Promise<Response>(() => {}));
    client = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage });
    client.mount('#stories');
    const bar = document.querySelector<HTMLElement>('[data-stories-bar]')!.shadowRoot!;
    await vi.waitFor(() => expect(circles(bar)).toHaveLength(2));
    expect(bar.querySelector('.bar')!.classList.contains('pending')).toBe(true);
    await vi.waitFor(() =>
      expect(bar.querySelector('.bar')!.classList.contains('pending')).toBe(false),
    );
  });

  it('applies theme options as CSS variables and can update them live', async () => {
    const { bar, handle } = await mountBar({ theme: { circleSize: 80, ringColors: ['#ff0000'] } });
    const style = bar.querySelector<HTMLElement>('.bar')!.getAttribute('style')!;
    expect(style).toContain('--s-size:80px');
    // Without a server appearance, ring colours from code are applied per circle.
    expect(bar.querySelector<HTMLElement>('.c')!.getAttribute('style')).toContain(
      '--c-ring:#ff0000',
    );
    handle.update({ theme: { circleSize: 50, hideTitles: true } });
    expect(bar.querySelector('.bar')!.getAttribute('style')).toContain('--s-size:50px');
    expect(bar.querySelector('.title')).toBeNull();
  });

  it('calls onFail and hides itself when the token is invalid', async () => {
    fetchMock.mockImplementation(async () => new Response('{}', { status: 401 }));
    client = init({ token: 'pk_live_bad', apiUrl: 'https://api.test' });
    const onFail = vi.fn();
    client.mount('#stories', { onFail });
    await vi.waitFor(() => expect(onFail).toHaveBeenCalled());
    expect(onFail.mock.calls[0]![0]).toMatchObject({ code: 'invalid_token' });
    expect(document.querySelector<HTMLElement>('[data-stories-bar]')!.hidden).toBe(true);
  });

  it('removes itself on destroy', async () => {
    const { handle } = await mountBar();
    handle.destroy();
    expect(document.querySelector('[data-stories-bar]')).toBeNull();
  });
});

describe('viewer', () => {
  it('opens an accessible modal dialog when a circle is clicked', async () => {
    const onStoryOpen = vi.fn();
    const { bar } = await mountBar({ onStoryOpen });
    circles(bar)[0]!.click();

    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    expect(dialog()!.getAttribute('aria-label')).toBe('Stories: New in');
    expect(viewerRoot()!.activeElement).toBe(dialog());
    expect(live()).toBe('New in: story 1 of 2. Red jacket');
    expect(viewerRoot()!.querySelector('.media img')!.getAttribute('alt')).toBe('Red jacket');
    expect(onStoryOpen).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'gA', storyId: 'a1', storyIndex: 0 }),
    );
    const labels = [...viewerRoot()!.querySelectorAll('button')]
      .filter((b) => !b.hidden)
      .map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(
      expect.arrayContaining(['Previous story', 'Next story', 'Pause', 'Close stories']),
    );
    expect(document.documentElement.style.overflow).toBe('hidden');
  });

  it('supports keyboard navigation between stories and groups', async () => {
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    key('ArrowRight');
    expect(live()).toContain('story 2 of 2');
    key('ArrowLeft');
    expect(live()).toContain('story 1 of 2');
    key('ArrowRight', { shiftKey: true });
    expect(live()).toBe('Sale: story 1 of 1. Sale');
    key('PageUp');
    expect(live()).toContain('New in: story 1');
  });

  it('closes with Escape, restores focus to the circle and marks the group seen', async () => {
    const onClose = vi.fn();
    const { bar } = await mountBar({ onClose });
    circles(bar)[0]!.click();
    key('ArrowRight'); // view both stories of "New in"
    key('Escape');

    expect(document.querySelector('[data-stories-viewer]')).toBeNull();
    expect(onClose).toHaveBeenCalledWith('user');
    expect(document.documentElement.style.overflow).toBe('');
    expect(bar.activeElement?.getAttribute('aria-label')).toBe('New in, 2 stories, viewed');
    // Re-rendered with the viewed ring style.
    expect(bar.querySelector('li[data-group="gA"]')!.className).toBe('seen');
    expect(circles(bar)[0]!.getAttribute('aria-label')).toBe('New in, 2 stories, viewed');
  });

  it('closes on a swipe down when the frame is centred on a large screen', async () => {
    const onClose = vi.fn();
    const { bar } = await mountBar({ onClose });
    circles(bar)[0]!.click();
    const frame = viewerRoot()!.querySelector<HTMLElement>('.frame')!;
    // A desktop-style frame: 400px wide, starting 600px from the left of the page.
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 30, 400, 710));
    const pointer = (type: string, x: number, y: number) =>
      frame.dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, composed: true }),
      );
    pointer('pointerdown', 800, 150);
    pointer('pointermove', 802, 260);
    pointer('pointermove', 803, 420);
    pointer('pointerup', 803, 420);

    expect(onClose).toHaveBeenCalledWith('user');
    expect(document.querySelector('[data-stories-viewer]')).toBeNull();
  });

  it('hides the focus ring on the circle after a mouse/touch open, but keeps it for keyboard users', async () => {
    const { bar } = await mountBar();
    // Mouse/touch click (detail 1) → close → focus returns without the ring marker.
    circles(bar)[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    key('Escape');
    const afterPointer = circles(bar)[0]!;
    expect(bar.activeElement).toBe(afterPointer);
    expect(afterPointer.hasAttribute('data-pointer-focus')).toBe(true);
    // Pressing a key brings the ring back.
    afterPointer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(afterPointer.hasAttribute('data-pointer-focus')).toBe(false);

    // Keyboard activation (detail 0) keeps the normal focus ring.
    circles(bar)[1]!.click();
    key('Escape');
    expect(bar.activeElement).toBe(circles(bar)[1]);
    expect(circles(bar)[1]!.hasAttribute('data-pointer-focus')).toBe(false);
  });

  it('auto-advances when the story duration elapses, but not while loading or paused', async () => {
    vi.useFakeTimers({
      toFake: [
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
        'setTimeout',
        'clearTimeout',
      ],
    });
    const { bar } = await mountBar();
    circles(bar)[0]!.click();

    vi.advanceTimersByTime(6000); // image not loaded yet: no progress
    expect(live()).toContain('story 1 of 2');

    loadImage();
    key('k'); // pause
    vi.advanceTimersByTime(6000);
    expect(live()).toContain('story 1 of 2');
    expect(viewerRoot()!.querySelector('.pause')!.getAttribute('aria-label')).toBe('Play');

    key('k'); // resume
    vi.advanceTimersByTime(5200);
    expect(live()).toContain('story 2 of 2');
  });

  it('closes after the last story and resumes groups at the first unseen story', async () => {
    vi.useFakeTimers({
      toFake: [
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
        'setTimeout',
        'clearTimeout',
      ],
    });
    const onClose = vi.fn();
    const { bar } = await mountBar({ onClose });
    circles(bar)[1]!.click(); // "Sale" has one story
    loadImage();
    vi.advanceTimersByTime(5200);
    expect(onClose).toHaveBeenCalledWith('completed');

    // Watch only the first story of "New in", then reopen: it resumes at story 2.
    circles(bar)[0]!.click();
    key('Escape');
    circles(bar)[0]!.click();
    expect(live()).toContain('story 2 of 2');
  });

  it('shows allowed CTAs only and lets the host handle the click', async () => {
    const onCtaClick = vi.fn(() => false as const);
    const { bar } = await mountBar({ onCtaClick });
    circles(bar)[1]!.click();
    // javascript: links are never rendered.
    expect(viewerRoot()!.querySelector<HTMLElement>('.cta-wrap')!.hidden).toBe(true);
    key('PageUp');
    key('ArrowRight');
    loadImage();
    const cta = viewerRoot()!.querySelector<HTMLButtonElement>('.cta')!;
    expect(cta.textContent).toBe('Shop now');
    cta.click();
    expect(onCtaClick).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'demo://product/2',
        label: 'Shop now',
        groupId: 'gA',
        storyId: 'a2',
      }),
    );
    expect(dialog()).not.toBeNull();
  });

  it('styles the button, and a swipe-up button opens on a swipe up', async () => {
    const story = feed.groups[0]!.stories[1]!;
    story.cta = { label: 'Shop now', url: 'demo://product/2', style: 'swipe' };
    try {
      const onCtaClick = vi.fn(() => false as const);
      const { bar } = await mountBar({ onCtaClick });
      circles(bar)[0]!.click();
      const frame = viewerRoot()!.querySelector<HTMLElement>('.frame')!;
      vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 710));
      const swipeUp = () => {
        const pointer = (type: string, y: number) =>
          frame.dispatchEvent(
            new MouseEvent(type, { clientX: 200, clientY: y, bubbles: true, composed: true }),
          );
        pointer('pointerdown', 500);
        pointer('pointermove', 400);
        pointer('pointermove', 250);
        pointer('pointerup', 250);
      };
      key('ArrowRight');
      loadImage();
      expect(viewerRoot()!.querySelector('.cta-wrap')!.className).toBe('cta-wrap swipe');
      expect(viewerRoot()!.querySelector('.cta')!.className).toBe('cta swipe');
      swipeUp();
      expect(onCtaClick).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'demo://product/2', storyId: 'a2' }),
      );
    } finally {
      story.cta = { label: 'Shop now', url: 'demo://product/2' };
    }
  });

  it('ignores a swipe up when the button isn’t a swipe up', async () => {
    const onCtaClick = vi.fn(() => false as const);
    const { bar } = await mountBar({ onCtaClick });
    circles(bar)[0]!.click();
    key('ArrowRight');
    loadImage();
    expect(viewerRoot()!.querySelector('.cta')!.className).toBe('cta pill');
    const frame = viewerRoot()!.querySelector<HTMLElement>('.frame')!;
    vi.spyOn(frame, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 710));
    for (const [type, y] of [
      ['pointerdown', 500],
      ['pointermove', 400],
      ['pointermove', 250],
      ['pointerup', 250],
    ] as const) {
      frame.dispatchEvent(
        new MouseEvent(type, { clientX: 200, clientY: y, bubbles: true, composed: true }),
      );
    }
    expect(onCtaClick).not.toHaveBeenCalled();
  });

  it('opens CTAs in a new tab with ctaTarget "_blank" and pauses the story', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const { bar } = await mountBar({ ctaTarget: '_blank' });
    circles(bar)[0]!.click();
    key('ArrowRight');
    loadImage();
    viewerRoot()!.querySelector<HTMLButtonElement>('.cta')!.click();
    expect(open).toHaveBeenCalledWith('demo://product/2', '_blank', 'noopener');
    expect(viewerRoot()!.querySelector('.pause')!.getAttribute('aria-label')).toBe('Play');
  });

  it('keeps a story’s button with its photo while the next photo loads', async () => {
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    loadImage();
    const wrap = () => viewerRoot()!.querySelector<HTMLElement>('.cta-wrap')!;
    expect(wrap().hidden).toBe(true);
    key('ArrowRight');
    // The first story is still on screen: no button yet.
    expect(wrap().hidden).toBe(true);
    loadImage();
    expect(wrap().hidden).toBe(false);
    key('ArrowLeft');
    // Going back, the button stays until the first story's photo is ready.
    expect(wrap().hidden).toBe(false);
    loadImage();
    expect(wrap().hidden).toBe(true);
  });

  it('keeps the current story on screen until the next one is ready, so skipping never flashes black', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    loadImage();
    const srcs = () =>
      [...viewerRoot()!.querySelectorAll<HTMLImageElement>('.media img')].map((i) => i.src);
    expect(srcs()).toEqual(['https://cdn.test/a1.png']);

    key('ArrowRight');
    // The new story loads underneath; the old one still covers it.
    expect(srcs()).toEqual(['https://cdn.test/a2.png', 'https://cdn.test/a1.png']);
    loadImage();
    expect(srcs()).toEqual(['https://cdn.test/a2.png']);

    // Across groups too; a slow load gives up the old story for the spinner.
    key('ArrowRight');
    expect(srcs()).toEqual(['https://cdn.test/b1.png', 'https://cdn.test/a2.png']);
    vi.advanceTimersByTime(400);
    expect(srcs()).toEqual(['https://cdn.test/b1.png']);
    expect(viewerRoot()!.querySelector('.spinner')!.hasAttribute('hidden')).toBe(false);
  });

  it('preloads the stories a tap or swipe would show next', async () => {
    const { bar } = await mountBar();
    const loads: [HTMLImageElement, string][] = [];
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
    const spy = vi.spyOn(HTMLImageElement.prototype, 'src', 'set').mockImplementation(function (
      this: HTMLImageElement,
      v: string,
    ) {
      loads.push([this, v]);
      desc.set!.call(this, v);
    });
    circles(bar)[0]!.click();
    spy.mockRestore();
    // Off-screen images: next story, previous (restarts the first) and the next group.
    const preloaded = loads.filter(([img]) => !img.isConnected).map(([, v]) => v);
    expect(preloaded).toEqual([
      'https://cdn.test/a2.png',
      'https://cdn.test/a1.png',
      'https://cdn.test/b1.png',
    ]);
  });

  it('keeps Tab focus inside the dialog', async () => {
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    const buttons = [...viewerRoot()!.querySelectorAll<HTMLButtonElement>('button')].filter(
      (b) => !b.hidden && !b.closest('[hidden]'),
    );
    buttons.at(-1)!.focus();
    key('Tab');
    expect(viewerRoot()!.activeElement).toBe(buttons[0]);
    key('Tab', { shiftKey: true });
    expect(viewerRoot()!.activeElement).toBe(buttons.at(-1));
  });
});

describe('analytics', () => {
  it('sends impressions, opens, views and CTA clicks in batches', async () => {
    const { bar } = await mountBar({ onCtaClick: () => false });
    await sleep(1100); // circles on screen for a second count as impressions
    circles(bar)[0]!.click();
    loadImage(); // a story counts as viewed after a second on screen (MRC/IAB)
    await sleep(1100);
    key('ArrowRight');
    loadImage();
    await sleep(1100);
    viewerRoot()!.querySelector<HTMLButtonElement>('.cta')!.click();
    key('ArrowRight'); // completes group A, opens B
    loadImage();
    await sleep(400); // b1 skipped before its viewable second: not a view
    client!.destroy();
    client = null;

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/events'));
    expect(call![0]).toBe('https://api.test/v1/events?token=pk_live_test');
    const body = JSON.parse(call![1].body);
    expect(body.sdk).toBe('web@test');
    expect(
      body.events.map(
        (e: { type: string; storyId?: string; groupId: string }) =>
          `${e.type}:${e.storyId ?? e.groupId}`,
      ),
    ).toEqual([
      'impression:gA',
      'impression:gB',
      'group_open:gA',
      'story_view:a1',
      'tap_forward:a1',
      'story_view:a2',
      'cta_click:a2',
      'tap_forward:a2',
      'group_complete:gA',
      'group_open:gB',
      'exit:b1',
    ]);
  });

  it('only counts circles seen for a second, and stories that appeared', async () => {
    const { bar } = await mountBar();
    await sleep(400);
    circles(bar)[0]!.click(); // opened, but left before the image loaded
    key('Escape');
    client!.destroy();
    client = null;
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/events'));
    const types = JSON.parse(call![1].body).events.map((e: { type: string }) => e.type);
    // The open and the exit count; no impression, since nothing appeared.
    expect(types).toEqual(['group_open', 'exit']);
  });

  it('sends an anonymous viewer ID for reach, kept between page loads', async () => {
    const storage = memoryStorage();
    const sentViewers = async () => {
      client = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage });
      const loaded = vi.fn();
      client.mount('#stories', { onLoad: loaded });
      await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
      await sleep(1100);
      client.destroy();
      client = null;
      const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/v1/events'));
      const viewer = JSON.parse(calls.at(-1)![1].body).viewer as string;
      return viewer;
    };
    const first = await sentViewers();
    expect(first).toMatch(/^[\w-]{8,}$/);
    expect(await sentViewers()).toBe(first);
  });

  it('can leave reach out until consent, and forget the ID', async () => {
    const storage = memoryStorage();
    client = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage, reach: false });
    const loaded = vi.fn();
    client.mount('#stories', { onLoad: loaded });
    await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
    await sleep(1100);
    expect(storage.getItem('stories:viewer')).toBeNull();
    client.setReach(true);
    await vi.waitFor(() => expect(storage.getItem('stories:viewer')).toMatch(/"id"/));
    client.setReach(false);
    await vi.waitFor(() => expect(storage.getItem('stories:viewer')).toBe(''));
    client.destroy();
    client = null;
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/events'));
    expect(JSON.parse(call![1].body).viewer).toBeUndefined();
  });

  it('records one page view per page load, and more on request (single-page apps)', async () => {
    const token = 'pk_live_PageViewTest000000000000';
    const make = () => init({ token, apiUrl: 'https://api.test', storage: memoryStorage() });
    const first = make();
    const second = make(); // a second client on the same page doesn't add another
    second.trackPageView(); // …but an explicit route change does
    first.destroy();
    second.destroy();
    const types = fetchMock.mock.calls
      .filter(([url]) => String(url).includes(token))
      .flatMap(([, init]) => JSON.parse(init.body).events.map((e: { type: string }) => e.type));
    expect(types).toEqual(['page_view', 'page_view']);
    const body = JSON.parse(
      fetchMock.mock.calls.find(([url]) => String(url).includes(token))![1].body,
    );
    expect(body.platform).toMatch(/^(desktop|mobile_web)$/);
  });

  it('tells desktop from mobile web', async () => {
    const { webPlatform } = await import('../src/client.js');
    const as = (userAgent: string, maxTouchPoints = 0) => {
      vi.stubGlobal('navigator', { userAgent, maxTouchPoints });
      return webPlatform();
    };
    expect(as('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130')).toBe('desktop');
    expect(as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605')).toBe('desktop');
    expect(as('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148')).toBe(
      'mobile_web',
    );
    expect(as('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile Safari/537.36')).toBe('mobile_web');
    // iPadOS Safari reports a Mac; touch support gives it away.
    expect(as('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', 5)).toBe('mobile_web');
  });

  it('can be disabled', async () => {
    client = init({ token: 'pk_live_test', apiUrl: 'https://api.test', analytics: false });
    const onLoad = vi.fn();
    client.mount('#stories', { onLoad });
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
    client.destroy();
    client = null;
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/v1/events'))).toBe(false);
  });
});

describe('story bars', () => {
  it('loads each bar’s own feed, and tags its events with the bar', async () => {
    document.body.innerHTML = '<div id="stories"></div><div id="pdp"></div>';
    const { handle } = await mountBar();
    const onLoad = vi.fn();
    client!.mount('#pdp', { bar: 'Product-Page', onLoad });
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
    const feeds = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((u) => u.includes('/v1/feed'));
    expect(feeds).toEqual([
      'https://api.test/v1/feed?token=pk_live_test',
      'https://api.test/v1/feed?token=pk_live_test&bar=product-page',
    ]);

    await sleep(1100); // both bars' circles count as impressions
    handle.destroy();
    client!.destroy();
    client = null;
    const events = fetchMock.mock.calls
      .filter(([url]) => String(url).includes('/v1/events'))
      .flatMap(([, init]) => JSON.parse(init.body).events)
      .filter((e: { type: string }) => e.type === 'impression');
    expect(
      events.map((e: { groupId: string; bar?: string }) => `${e.groupId}:${e.bar ?? ''}`).sort(),
    ).toEqual(['gA:', 'gA:product-page', 'gB:', 'gB:product-page']);
  });

  it('reports an unknown bar key through onFail', async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('bar=nope')
        ? new Response('{}', { status: 404 })
        : new Response(null, { status: 204 }),
    );
    client = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage: memoryStorage() });
    const onFail = vi.fn();
    client.mount('#stories', { bar: 'nope', onFail });
    await vi.waitFor(() => expect(onFail).toHaveBeenCalled());
    expect(onFail.mock.calls[0]![0].code).toBe('unknown_bar');
  });

  it('passes the bar attribute from <stories-bar>', async () => {
    defineStoriesElement();
    const el = document.createElement('stories-bar');
    el.setAttribute('token', 'pk_live_attr');
    el.setAttribute('api-url', 'https://api.test');
    el.setAttribute('bar', 'checkout');
    const loaded = vi.fn();
    el.addEventListener('stories-load', loaded);
    document.body.append(el);
    await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/feed?token=pk_live_attr&bar=checkout',
      expect.anything(),
    );
    el.remove();
  });
});

describe('user tags', () => {
  it('sends tags with the feed and reloads when they change', async () => {
    client = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage: memoryStorage() });
    const onLoad = vi.fn();
    const handle = client.mount('#stories', { tags: ['London'], onLoad });
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
    handle.update({ tags: ['london'] }); // same tags: no new request
    handle.update({ tags: ['london', 'premium'] });
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalledTimes(2));
    const feeds = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((u) => u.includes('/v1/feed'));
    expect(feeds).toEqual([
      'https://api.test/v1/feed?token=pk_live_test&tags=london',
      'https://api.test/v1/feed?token=pk_live_test&tags=london%2Cpremium',
    ]);
  });

  it('reads tags from the <stories-bar> attribute', async () => {
    defineStoriesElement();
    const el = document.createElement('stories-bar');
    el.setAttribute('token', 'pk_live_tags');
    el.setAttribute('api-url', 'https://api.test');
    el.setAttribute('tags', 'london, premium');
    const loaded = vi.fn();
    el.addEventListener('stories-load', loaded);
    document.body.append(el);
    await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/v1/feed?token=pk_live_tags&tags=london%2Cpremium',
      expect.anything(),
    );
    el.remove();
  });
});

describe('<stories-bar> element', () => {
  it('mounts from attributes and emits DOM events', async () => {
    defineStoriesElement();
    const el = document.createElement('stories-bar');
    el.setAttribute('token', 'pk_live_element');
    el.setAttribute('api-url', 'https://api.test');
    el.setAttribute('circle-size', '90');
    const loaded = vi.fn();
    el.addEventListener('stories-load', loaded);
    document.body.append(el);
    await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
    expect((loaded.mock.calls[0]![0] as CustomEvent).detail.groups).toHaveLength(2);
    const bar = el.querySelector('[data-stories-bar]')!.shadowRoot!;
    expect(bar.querySelector('.bar')!.getAttribute('style')).toContain('--s-size:90px');

    el.setAttribute('circle-size', '40');
    expect(bar.querySelector('.bar')!.getAttribute('style')).toContain('--s-size:40px');
    el.remove();
    expect(el.querySelector('[data-stories-bar]')).toBeNull();
  });

  it('mounts when the token is set after the element is connected', async () => {
    defineStoriesElement();
    const el = document.createElement('stories-bar');
    el.setAttribute('api-url', 'https://api.test');
    const loaded = vi.fn();
    el.addEventListener('stories-load', loaded);
    document.body.append(el);
    expect(el.querySelector('[data-stories-bar]')).toBeNull();
    el.setAttribute('token', 'pk_live_late');
    await vi.waitFor(() => expect(loaded).toHaveBeenCalled());
    el.remove();
  });
});

describe('previewStories', () => {
  it('opens the viewer on draft groups without tracking or navigating', async () => {
    const { previewStories } = await import('../src/preview-entry.js');
    const onClose = vi.fn();
    const open = vi.spyOn(window, 'open');
    const p = previewStories({
      groups: feed.groups,
      startIndex: 0,
      deepLinkSchemes: ['demo'],
      onClose,
    });
    expect(dialog()!.getAttribute('aria-label')).toBe('Stories: New in');
    key('ArrowRight');
    viewerRoot()!.querySelector<HTMLButtonElement>('.cta')!.click();
    expect(open).not.toHaveBeenCalled();
    p.close();
    expect(onClose).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('story names', () => {
  it('shows the story name in the header, falling back to the group title', async () => {
    const { previewStories } = await import('../src/preview-entry.js');
    const groups = [
      {
        ...feed.groups[0]!,
        stories: [
          { ...feed.groups[0]!.stories[0]!, title: 'New in' },
          { ...feed.groups[0]!.stories[1]!, title: 'Blue scarf' },
        ],
      },
      { ...feed.groups[1]!, stories: feed.groups[1]!.stories.map(({ title: _t, ...s }) => s) },
    ];
    const p = previewStories({ groups });
    const name = () => viewerRoot()!.querySelector('.name')!.textContent;
    expect(name()).toBe('New in');
    expect(live()).toBe('New in: story 1 of 2. Red jacket');
    key('ArrowRight');
    expect(name()).toBe('Blue scarf');
    expect(live()).toBe('New in: story 2 of 2, Blue scarf. Blue scarf');
    key('ArrowRight');
    // Older servers don't send a title: the group title is used.
    expect(name()).toBe('Sale');
    p.close();
  });
});

describe('embedded preview', () => {
  it('renders inside a container without locking the page or taking focus, and loops', async () => {
    vi.useFakeTimers({
      toFake: [
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
        'setTimeout',
        'clearTimeout',
      ],
    });
    const { previewStories } = await import('../src/preview-entry.js');
    const frame = document.createElement('div');
    document.body.append(frame);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    const onClose = vi.fn();
    const p = previewStories({ groups: [feed.groups[1]!], container: frame, onClose });
    const root = frame.querySelector('[data-stories-viewer]')!.shadowRoot!;
    const region = root.querySelector('[role="region"]')!;
    expect(region.getAttribute('aria-modal')).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
    expect(document.activeElement).toBe(outside);
    expect(document.querySelector('body > [data-stories-viewer]')).toBeNull();

    // One-story group: finishing restarts it instead of closing.
    root.querySelector('.media img')!.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(5200);
    expect(onClose).not.toHaveBeenCalled();
    expect(frame.querySelector('[data-stories-viewer]')).not.toBeNull();

    // update() swaps content in place; close() calls onClose.
    p.update([feed.groups[0]!]);
    const root2 = frame.querySelector('[data-stories-viewer]')!.shadowRoot!;
    expect(root2.querySelector('[aria-live]')!.textContent).toContain('New in: story 1 of 2');
    expect(frame.querySelectorAll('[data-stories-viewer]')).toHaveLength(1);
    p.close();
    expect(onClose).toHaveBeenCalledOnce();
    expect(frame.querySelector('[data-stories-viewer]')).toBeNull();
  });
});

describe('sharing', () => {
  const sharingFeed: FeedDto = { ...feed, app: { ...feed.app, sharing: true } };
  const serve = (body: FeedDto) =>
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/v1/feed')
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response(null, { status: 204 }),
    );
  const shareButton = () => viewerRoot()!.querySelector<HTMLButtonElement>('.btn.share')!;
  const toast = () => viewerRoot()!.querySelector<HTMLElement>('.toast')!;
  const stubNavigator = (props: Record<string, unknown>) => {
    for (const [k, value] of Object.entries(props)) {
      Object.defineProperty(navigator, k, { value, configurable: true });
    }
  };
  const sentEvents = () => {
    client!.destroy();
    client = null;
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/v1/events'));
    return JSON.parse(call![1].body).events.map(
      (e: { type: string; storyId?: string; groupId: string }) =>
        `${e.type}:${e.storyId ?? e.groupId}`,
    ) as string[];
  };

  afterEach(() => {
    for (const k of ['share', 'canShare', 'clipboard']) {
      delete (navigator as unknown as Record<string, unknown>)[k];
    }
    history.replaceState(null, '', '/');
  });

  it('shows the Share button only when the website has sharing turned on', async () => {
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    expect(shareButton().hidden).toBe(true);
    client!.destroy();

    serve(sharingFeed);
    const { bar: bar2 } = await mountBar();
    circles(bar2)[0]!.click();
    expect(shareButton().hidden).toBe(false);
    expect(shareButton().getAttribute('aria-label')).toBe('Share story');
  });

  it('opens the share sheet with a link to the current story, paused while it is open', async () => {
    serve(sharingFeed);
    let finish!: () => void;
    const share = vi.fn(() => new Promise<void>((r) => (finish = r)));
    stubNavigator({ share });
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    key('ArrowRight');
    shareButton().click();

    expect(share).toHaveBeenCalledWith({
      title: 'New in',
      url: `${location.origin}/#stories=gA/a2`,
    });
    const frame = viewerRoot()!.querySelector('.frame')!;
    expect(frame.hasAttribute('data-paused')).toBe(true);
    finish();
    await vi.waitFor(() => expect(frame.hasAttribute('data-paused')).toBe(false));
    expect(sentEvents()).toContain('share:a2');
  });

  it('copies the link where the share sheet is unavailable', async () => {
    serve(sharingFeed);
    const writeText = vi.fn(async () => {});
    stubNavigator({ clipboard: { writeText } });
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    shareButton().click();
    await vi.waitFor(() => expect(toast().hidden).toBe(false));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/#stories=gA/a1`);
    expect(toast().textContent).toBe('Link copied');
    expect(toast().getAttribute('role')).toBe('status');
    expect(sentEvents()).toContain('share:a1');
  });

  it('does nothing (and counts nothing) when the share sheet is dismissed', async () => {
    serve(sharingFeed);
    const writeText = vi.fn(async () => {});
    stubNavigator({
      share: vi.fn(async () => {
        throw new DOMException('Cancelled', 'AbortError');
      }),
      clipboard: { writeText },
    });
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    shareButton().click();
    await new Promise((r) => setTimeout(r, 0));
    expect(writeText).not.toHaveBeenCalled();
    expect(toast().hidden).toBe(true);
    expect(sentEvents().some((e) => e.startsWith('share:'))).toBe(false);
  });

  it('lets the site handle sharing itself via onShare', async () => {
    serve(sharingFeed);
    const share = vi.fn(async () => {});
    stubNavigator({ share });
    const onShare = vi.fn(() => false);
    const { bar } = await mountBar({ onShare });
    circles(bar)[1]!.click();
    shareButton().click();
    expect(onShare).toHaveBeenCalledWith({
      url: `${location.origin}/#stories=gB/b1`,
      title: 'Sale',
      groupId: 'gB',
      storyId: 'b1',
    });
    expect(share).not.toHaveBeenCalled();
    expect(sentEvents()).toContain('share:b1');
  });

  it('opens a shared link at its story and removes it from the address', async () => {
    history.replaceState(null, '', '/article?x=1#stories=gA/a2');
    await mountBar();
    await vi.waitFor(() => expect(dialog()).not.toBeNull());
    expect(live()).toContain('New in: story 2 of 2');
    expect(location.href).toBe(`${location.origin}/article?x=1`);
  });

  it('ignores shared links to groups that are not in the bar', async () => {
    history.replaceState(null, '', '/#stories=gone/x');
    await mountBar();
    expect(dialog()).toBeNull();
    expect(location.hash).toBe('#stories=gone/x');
  });

  it('can be told not to open shared links', async () => {
    history.replaceState(null, '', '/#stories=gA/a1');
    await mountBar({ openSharedLinks: false });
    expect(dialog()).toBeNull();
  });
});

describe('bar layout from the dashboard', () => {
  const serve = (body: FeedDto) =>
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/v1/feed')
        ? new Response(JSON.stringify(body), { status: 200 })
        : new Response(null, { status: 204 }),
    );
  const vars = (bar: ShadowRoot) => bar.querySelector('.bar')!.getAttribute('style')!;

  it('uses the code theme size when the dashboard sets none', async () => {
    const { bar } = await mountBar({ theme: { circleSize: 80, gap: 20 } });
    expect(vars(bar)).toContain('--s-size:80px;--s-h:80px;--s-r:40px');
    expect(vars(bar)).toContain('--s-gap:20px');
  });

  it('applies the dashboard shape and size over the code theme', async () => {
    serve({
      ...feed,
      app: { ...feed.app, layout: { width: 72, height: 112, corner: 25, gap: 8 } },
    });
    const { bar } = await mountBar({ theme: { circleSize: 80, gap: 20, titleSize: 13 } });
    // Radius = 25% of the shorter side; title size still comes from the code theme.
    expect(vars(bar)).toContain('--s-size:72px;--s-h:112px;--s-r:18px');
    expect(vars(bar)).toContain('--s-gap:8px');
    expect(vars(bar)).toContain('--s-title-size:13px');
  });
});

describe('interactive stickers', () => {
  const withStickers: FeedDto = {
    ...feed,
    groups: [
      {
        ...feed.groups[0]!,
        stories: [
          {
            ...feed.groups[0]!.stories[0]!,
            interactions: [
              {
                id: 'p1',
                kind: 'poll',
                x: 540,
                y: 1200,
                width: 760,
                accent: '#c2255c',
                question: 'Which?',
                options: ['Red', 'Blue'],
              },
              {
                id: 'l1',
                kind: 'link',
                x: 540,
                y: 400,
                width: 520,
                accent: '#c2255c',
                label: 'Shop',
                url: 'demo://sale',
              },
            ],
          },
          feed.groups[0]!.stories[1]!,
        ],
      },
    ],
  };

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/v1/feed'))
        return new Response(JSON.stringify(withStickers), { status: 200 });
      if (String(url).includes('/v1/answers')) {
        return new Response(JSON.stringify({ results: { total: 4, counts: [3, 1] } }), {
          status: 200,
        });
      }
      return new Response(null, { status: 204 });
    });
  });

  it('votes in a poll without leaving the story, and shows the results', async () => {
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    loadImage();
    const stickers = viewerRoot()!.querySelector('.stickers')!;
    const options = () => [...stickers.querySelectorAll<HTMLButtonElement>('.opt')];
    expect(options().map((b) => b.textContent)).toEqual(['Red', 'Blue']);

    // A tap on a sticker never reaches the tap-to-skip gestures.
    stickers
      .querySelector('.opt')!
      .dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    options()[0]!.click();
    const call = fetchMock.mock.calls.find(([u]) => String(u).includes('/v1/answers'))!;
    expect(call[0]).toBe('https://api.test/v1/answers?token=pk_live_test');
    expect(JSON.parse(call[1].body)).toMatchObject({
      storyId: 'a1',
      interactionId: 'p1',
      value: 0,
    });
    await vi.waitFor(() => expect(options()[0]!.textContent).toBe('✓ Red75%'));
    expect(options()[1]!.getAttribute('aria-label')).toBe('Blue, 25%');
    expect(options().every((b) => b.disabled)).toBe(true);
    expect(live()).toContain('story 1 of 2');
  });

  it('opens a link sticker like the story button', async () => {
    const onCtaClick = vi.fn(() => false as const);
    const { bar } = await mountBar({ onCtaClick });
    circles(bar)[0]!.click();
    viewerRoot()!.querySelector<HTMLButtonElement>('.link-pill')!.click();
    expect(onCtaClick).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'demo://sale', label: 'Shop', storyId: 'a1' }),
    );
  });
});

describe('fitting the screen', () => {
  it('covers the screen for "fill", and shows "fit" stories whole on their gap colours', async () => {
    const looks: FeedDto = {
      ...feed,
      groups: [
        {
          ...feed.groups[0]!,
          stories: [
            { ...feed.groups[0]!.stories[0]!, fit: 'fill' },
            {
              ...feed.groups[0]!.stories[1]!,
              fit: 'fit',
              fill: { top: '#112233', bottom: '#445566' },
            },
          ],
        },
      ],
    };
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/v1/feed')
        ? new Response(JSON.stringify(looks), { status: 200 })
        : new Response(null, { status: 204 }),
    );
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    // The newest story is first: it loads under the previous one.
    const img = () => viewerRoot()!.querySelector<HTMLElement>('.media img')!;
    expect(img().style.objectFit).toBe('cover');
    expect(img().style.background).toContain('rgb(0, 0, 0)');
    key('ArrowRight');
    expect(img().style.objectFit).toBe('contain');
    // On the story, so the previous one keeps its own gap colours until it's gone.
    expect(img().style.background).toContain('linear-gradient');
  });
});

describe('overlays on designed videos', () => {
  const withOverlay: FeedDto = {
    ...feed,
    groups: [
      {
        ...feed.groups[0]!,
        stories: [
          {
            ...feed.groups[0]!.stories[0]!,
            type: 'video',
            url: 'https://cdn.example.com/v.mp4',
            fit: 'fill',
            overlay: 'https://cdn.example.com/overlay.png',
          },
          // A photo's text is in its image: no overlay, whatever is sent.
          { ...feed.groups[0]!.stories[1]!, overlay: 'https://cdn.example.com/other.png' },
        ],
      },
    ],
  };

  beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes('/v1/feed')
        ? new Response(JSON.stringify(withOverlay), { status: 200 })
        : new Response(null, { status: 204 }),
    );
  });

  it('draws the overlay over the video once it has loaded, fitted like the story', async () => {
    const { bar } = await mountBar();
    circles(bar)[0]!.click();
    const overlay = viewerRoot()!.querySelector<HTMLImageElement>('.overlay')!;
    expect(overlay.getAttribute('src')).toBe('https://cdn.example.com/overlay.png');
    expect(overlay.style.objectFit).toBe('cover');
    expect(overlay.hidden).toBe(true);
    overlay.dispatchEvent(new Event('load'));
    expect(overlay.hidden).toBe(false);
  });
});
