import { normalizeTags } from '@stories/contracts/tags';
import {
  type AnswerStore,
  type FeedDto,
  type FeedGroupDto,
  labels,
  parseShareLink,
  resolveTheme,
  type SeenStore,
  StoriesError,
  type StoriesTheme,
  type TrackedEvent,
  withoutShareLink,
} from '@stories/core';
import { badgeSpeech, environment, renderCircle, themeAppearance } from './circle.js';
import type { StoriesClient } from './client.js';
import { h } from './dom.js';
import { loadedViewer, loadViewer } from './load-viewer.js';
import { BAR_CSS, themeVars } from './styles.js';
import type { CircleRect, StoriesTransition, Viewer, ViewerCallbacks } from './viewer.js';

export interface MountOptions extends ViewerCallbacks {
  /**
   * Which story bar to show: its key from the dashboard (Settings → Apps & websites),
   * e.g. "product-page". Omitted = the main bar. Fixed once mounted.
   */
  bar?: string;
  /**
   * Tags for the person viewing (e.g. ["london", "premium"]), from your own user data. Story
   * groups with a tag filter (Edit group → Audience) only show to people whose tags pass it.
   * Use labels for groups of people, never personal data such as emails or IDs. Can be changed
   * with update({ tags }), e.g. after sign-in.
   */
  tags?: readonly string[];
  theme?: Partial<StoriesTheme>;
  /** Called with the published groups once loaded (may be empty). */
  onLoad?(groups: FeedGroupDto[]): void;
  /** Called if the feed can't be loaded. The bar stays empty and hidden. */
  onFail?(error: StoriesError): void;
  /** How CTA links open when not handled in onCtaClick. Default "_self". */
  ctaTarget?: '_self' | '_blank';
  /**
   * How the viewer opens and closes: 'slide' (default: up from the bottom, shrinking away
   * towards the bottom) or 'zoom' (out of the clicked circle and back into it).
   */
  transition?: StoriesTransition;
  /** Open the story a shared link points to (…#stories=…) when the page loads. Default true. */
  openSharedLinks?: boolean;
}

export interface StoriesBarHandle {
  /** Published groups currently shown. */
  readonly groups: readonly FeedGroupDto[];
  /** Opens the viewer at a group (by id or index). Returns false if not found. */
  open(group: string | number): boolean;
  close(): void;
  /** Refetches the feed and re-renders. */
  refresh(): Promise<void>;
  /** Changes theme/callbacks without remounting. */
  update(options: MountOptions): void;
  destroy(): void;
}

const SKELETON_COUNT = 5;
/** Viewability: how long a circle must stay at least half on screen to count as an impression. */
const VIEWABLE_MS = 1000;
/** How many groups, from the start of the bar, have their first story loaded with the feed. */
const PRELOAD_GROUPS = 4;
/** Longest a tap waits for the first story's image before opening the viewer on a spinner. */
const OPEN_WAIT_MS = 1500;
/** Longest the bar stays hidden on load while waiting for the live feed and covers. */
const REVEAL_WAIT_MS = 500;

export class StoryBar implements StoriesBarHandle {
  private readonly container = h('div', { 'data-stories-bar': '' });
  private readonly root: ShadowRoot;
  private readonly wrapper = h('div', { class: 'bar' });
  private feed: FeedDto | null = null;
  private seen: SeenStore | null = null;
  private answers: AnswerStore | null = null;
  private viewer: Viewer | null = null;
  private observer: IntersectionObserver | null = null;
  private impressed = new Set<string>();
  private visible = new Set<Element>();
  private timers = new Map<Element, ReturnType<typeof setTimeout>>();
  private onVisibility: (() => void) | null = null;
  private destroyed = false;
  private fresh = false;
  private faded = false;
  private revealTimer: ReturnType<typeof setTimeout> | undefined;
  private countdownTimer: ReturnType<typeof setInterval> | null = null;
  private readonly bar: string;
  private tags: string[];

  constructor(
    private readonly client: StoriesClient,
    target: HTMLElement,
    private options: MountOptions,
    private readonly onDestroy: () => void,
  ) {
    this.bar = options.bar?.trim().toLowerCase() ?? '';
    this.tags = normalizeTags(options.tags);
    this.root = this.container.attachShadow({ mode: 'open' });
    this.root.append(h('style', {}, BAR_CSS), this.wrapper);
    for (const type of ['pointerover', 'focusin', 'touchstart'])
      this.wrapper.addEventListener(type, this.warmViewer, { once: true, passive: true });
    target.append(this.container);
    this.applyTheme();
    this.renderSkeleton();
    // Hidden (but holding its space) until the live feed is in, so neither
    // placeholders nor an outdated remembered feed flash before the real bar.
    this.wrapper.classList.add('pending');
    this.revealTimer = setTimeout(() => this.reveal(), REVEAL_WAIT_MS);
    void this.load(false);
  }

  private reveal() {
    clearTimeout(this.revealTimer);
    this.wrapper.classList.remove('pending');
    // Fade in the first time real circles become visible.
    if (this.faded || !this.feed) return;
    this.faded = true;
    if (!environment().reducedMotion) this.wrapper.animate?.([{ opacity: 0 }, { opacity: 1 }], 200);
  }

  get groups(): readonly FeedGroupDto[] {
    return this.feed?.groups ?? [];
  }

  async refresh(): Promise<void> {
    await this.load(true);
  }

  update(options: MountOptions): void {
    this.options = { ...this.options, ...options };
    this.applyTheme();
    if (this.feed) this.render();
    // Different tags can mean different groups, so load the feed for the new ones.
    const tags = normalizeTags(this.options.tags);
    if (tags.join() !== this.tags.join()) {
      this.tags = tags;
      void this.load(false);
    }
  }

  open(group: string | number): boolean {
    return this.openGroup(group, false);
  }

  /**
   * `byPointer`: opened with a mouse/touch click. Focus still returns to the
   * circle afterwards (for screen readers), but without the keyboard focus ring.
   */
  /** Group `index`'s circle on screen, if at least half of it is visible. */
  private circleRect(index: number): CircleRect | null {
    const ring = this.root.querySelector<HTMLElement>(`[data-index="${index}"] .ring`);
    if (!ring) return null;
    const r = ring.getBoundingClientRect();
    const shown = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    if (r.width <= 0 || shown < r.width / 2 || r.bottom <= 0 || r.top >= innerHeight) return null;
    const radius = getComputedStyle(ring).borderTopLeftRadius;
    const px = radius.endsWith('%')
      ? (Number.parseFloat(radius) / 100) * Math.min(r.width, r.height)
      : Number.parseFloat(radius) || 0;
    return {
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
      radius: Math.min(px, r.width / 2),
    };
  }

  private openGroup(group: string | number, byPointer: boolean, startStoryId?: string): boolean {
    const index = typeof group === 'number' ? group : this.groups.findIndex((g) => g.id === group);
    if (!this.feed || !this.seen || index < 0 || index >= this.groups.length) return false;
    // Decode the first story's image off the main thread first, so the viewer doesn't open on
    // black and a spinner, and decoding it doesn't stall the opening motion. The first stories
    // were decoded with the feed (see preloadFirstStories), so this is normally at once;
    // meanwhile the circle stays pressed.
    const g = this.groups[index]!;
    const linked = startStoryId ? g.stories.find((st) => st.id === startStoryId) : undefined;
    const first = linked ?? g.stories[this.seen.firstUnseenIndex(g)];
    const ticket = ++this.openTicket;
    // The viewer itself is normally loaded by now too (see warmViewer).
    const waits: Promise<unknown>[] = [];
    if (!loadedViewer()) waits.push(loadViewer());
    if (first?.type === 'image' && typeof HTMLImageElement.prototype.decode === 'function') {
      const img = new Image();
      img.src = first.url;
      const wait = new Promise<void>((done) => setTimeout(done, OPEN_WAIT_MS));
      waits.push(Promise.race([img.decode().catch(() => undefined), wait]));
    }
    if (waits.length === 0) {
      this.showViewer(index, byPointer, startStoryId);
      return true;
    }
    const item = this.root.querySelector<HTMLElement>(`[data-index="${index}"]`);
    item?.setAttribute('data-opening', '');
    void Promise.all(waits).then(
      () => {
        item?.removeAttribute('data-opening');
        if (ticket === this.openTicket && !this.destroyed)
          this.showViewer(index, byPointer, startStoryId);
      },
      (err: Error) => {
        // Offline, or the viewer script was blocked. Tapping again tries again.
        item?.removeAttribute('data-opening');
        console.warn(`[Stories] ${err.message}`);
      },
    );
    return true;
  }

  /** Starts loading the viewer when a circle is first pointed at, focused or touched. */
  private readonly warmViewer = () => {
    void loadViewer().catch(() => {});
  };

  private openTicket = 0;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: held so the decoded images are kept
  private firstStories: HTMLImageElement[] = [];

  private showViewer(index: number, byPointer: boolean, startStoryId?: string) {
    const viewerModule = loadedViewer();
    if (!this.feed || !this.seen || !viewerModule || index >= this.groups.length) return;
    this.viewer?.close();
    this.viewer = new viewerModule.Viewer({
      feed: this.feed,
      groupIndex: index,
      startStoryId,
      seen: this.seen,
      answers: this.answers,
      sendAnswer: (storyId, interactionId, value) =>
        this.client.sendAnswer({ storyId, interactionId, value }),
      track: (e) => this.track(e),
      ctaTarget: this.options.ctaTarget,
      transition: this.options.transition,
      circle: (i) => this.circleRect(i),
      onStoryOpen: (e) => this.options.onStoryOpen?.(e),
      onCtaClick: (e) => this.options.onCtaClick?.(e),
      onShare: (e) => this.options.onShare?.(e),
      onClose: (reason) => {
        this.viewer = null;
        if (!this.destroyed) {
          // Re-render for the updated "seen" rings, then return focus to the circle that opened it.
          this.render();
          const circle = this.root.querySelector<HTMLElement>(`[data-index="${index}"]`);
          if (circle) {
            if (byPointer) circle.dataset.pointerFocus = '';
            circle.focus({
              preventScroll: true,
              ...(byPointer ? { focusVisible: false } : {}),
            } as FocusOptions);
          }
        }
        this.options.onClose?.(reason);
      },
    });
  }

  close(): void {
    // Also cancels an open still waiting for its first image.
    this.openTicket++;
    this.viewer?.close();
  }

  /** Story events say which bar they came from, so analytics can be split by bar. */
  private track(e: TrackedEvent) {
    this.client.track(this.bar && 'groupId' in e ? { ...e, bar: this.bar } : e);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.revealTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.viewer?.close();
    this.stopImpressions();
    this.container.remove();
    this.onDestroy();
  }

  // ---------------------------------------------------------------------------

  /**
   * Draws the bar (still hidden) from the previous page load's feed: it takes the
   * right space at once, and shows if the network is slow.
   */
  private async showCached() {
    const feed = await this.client.cachedFeed(this.bar, this.tags);
    const seen = feed && (await this.client.seenStore(feed.app.id));
    if (!seen || this.feed || this.destroyed) return;
    this.feed = feed;
    this.seen = seen;
    this.answers = await this.client.answerStore(feed.app.id);
    this.render();
  }

  private async load(force: boolean) {
    if (!force) void this.showCached();
    try {
      const feed = await this.client.loadFeed(force, this.bar, this.tags);
      const seen = await this.client.seenStore(feed.app.id);
      this.answers = await this.client.answerStore(feed.app.id);
      if (this.destroyed) return;
      // Redraw only if something changed since the remembered feed, and only once
      // the new covers are loaded, so they don't pop in after the circles.
      const same = JSON.stringify(feed) === JSON.stringify(this.feed);
      if (!same) await preloadCovers(feed.groups);
      if (this.destroyed) return;
      this.feed = feed;
      this.seen = seen;
      this.firstStories = preloadFirstStories(feed.groups, seen);
      this.fresh = true;
      if (same) this.observeImpressions(this.wrapper.firstElementChild as HTMLElement);
      else this.render();
      this.reveal();
      this.options.onLoad?.(feed.groups);
      this.openSharedLink();
    } catch (err) {
      if (this.destroyed) return;
      clearTimeout(this.revealTimer);
      this.feed = null;
      this.wrapper.replaceChildren();
      this.container.hidden = true;
      const error =
        err instanceof StoriesError
          ? err
          : new StoriesError('network', (err as Error)?.message ?? 'Unknown error');
      if (this.options.onFail) this.options.onFail(error);
      else console.warn(`[Stories] ${error.message}`);
    }
  }

  /** Opens the story in the page URL's #stories=… fragment, if it belongs to this bar. */
  private openSharedLink() {
    if (this.options.openSharedLinks === false || this.viewer) return;
    if (typeof window === 'undefined') return;
    const target = parseShareLink(window.location.href);
    // Not ours (e.g. another bar on the page shows that group): leave it for that bar.
    if (!target || !this.groups.some((g) => g.id === target.groupId)) return;
    // Drop the fragment so a refresh doesn't reopen it, and other bars on the page don't either.
    history.replaceState(history.state, '', withoutShareLink(window.location.href));
    this.openGroup(target.groupId, false, target.storyId);
  }

  private applyTheme() {
    this.wrapper.setAttribute(
      'style',
      themeVars(resolveTheme(this.options.theme), this.feed?.app.layout),
    );
  }

  private renderSkeleton() {
    const items = Array.from({ length: SKELETON_COUNT }, () =>
      h(
        'li',
        { class: 'skeleton', 'aria-hidden': 'true' },
        h('span', { class: 'item' }, h('span', { class: 'ring' }), h('span', { class: 'title' })),
      ),
    );
    this.wrapper.replaceChildren(
      h('span', { class: 'sr', role: 'status' }, labels.loading),
      h('ul', { class: 'list', role: 'list', 'aria-busy': 'true' }, ...items),
    );
  }

  private render() {
    // The feed may carry the dashboard's bar layout (shape and size).
    this.applyTheme();
    const groups = this.groups;
    const seen = this.seen;
    this.container.hidden = groups.length === 0;
    const theme = resolveTheme(this.options.theme);
    const fallback = themeAppearance(theme);
    const env = environment();

    const items = groups.map((g, i) => {
      const isSeen = !!seen?.isGroupSeen(g);
      const appearance = g.appearance ?? fallback;
      const button = h(
        'button',
        {
          type: 'button',
          class: 'item',
          'data-index': i,
          'aria-label':
            labels.openGroup(g.title, g.stories.length, isSeen) + badgeSpeech(appearance, g.endsAt),
        },
        renderCircle(g, appearance, { seen: isSeen, ...env }),
      );
      // detail > 0: a real mouse/touch click (keyboard activation reports 0).
      button.addEventListener('click', (e) => this.openGroup(i, e.detail > 0));
      // The ring comes back as soon as the user navigates with the keyboard.
      const clearPointer = () => delete button.dataset.pointerFocus;
      button.addEventListener('keydown', clearPointer);
      button.addEventListener('blur', clearPointer);
      return h('li', { class: isSeen ? 'seen' : '', 'data-group': g.id }, button);
    });

    const list = h('ul', { class: 'list', role: 'list', 'aria-label': labels.bar }, ...items);
    this.wrapper.replaceChildren(list);
    // Impressions only count groups from the live feed, not the remembered one.
    if (this.fresh) this.observeImpressions(list);
    this.scheduleCountdown();
  }

  /** Countdown badges change at most once a minute; re-render only when their text changes. */
  private scheduleCountdown() {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = null;
    const hasCountdown = this.groups.some(
      (g) => g.appearance?.badge.type === 'countdown' && g.endsAt,
    );
    if (!hasCountdown) return;
    const signature = () =>
      this.groups.map((g) => (g.appearance ? badgeSpeech(g.appearance, g.endsAt) : '')).join('|');
    let last = signature();
    this.countdownTimer = setInterval(() => {
      const next = signature();
      if (next !== last && !this.viewer) {
        last = next;
        this.render();
      }
    }, 60_000);
  }

  /**
   * One impression per group per mount, by the MRC/IAB viewability rule: at least
   * half of the circle on screen for one continuous second, while the page is visible.
   */
  private observeImpressions(list: HTMLElement) {
    this.stopImpressions();
    const report = (li: Element) => {
      const id = (li as HTMLElement).dataset.group;
      this.visible.delete(li);
      this.observer?.unobserve(li);
      if (!id || this.impressed.has(id)) return;
      this.impressed.add(id);
      this.track({ type: 'impression', groupId: id });
    };
    const start = (li: Element) => {
      if (document.hidden || this.timers.has(li)) return;
      this.timers.set(
        li,
        setTimeout(() => {
          this.timers.delete(li);
          report(li);
        }, VIEWABLE_MS),
      );
    };
    const stop = (li: Element) => {
      clearTimeout(this.timers.get(li));
      this.timers.delete(li);
    };
    const items = [...list.children].filter(
      (li) => !this.impressed.has((li as HTMLElement).dataset.group ?? ''),
    );
    if (typeof IntersectionObserver === 'undefined') {
      for (const li of items) start(li);
      return;
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            this.visible.add(entry.target);
            start(entry.target);
          } else {
            this.visible.delete(entry.target);
            stop(entry.target);
          }
        }
      },
      { threshold: [0, 0.5] },
    );
    for (const li of items) this.observer.observe(li);
    // A hidden tab isn't viewable: the second starts again when it's shown.
    this.onVisibility = () => {
      for (const li of this.visible) (document.hidden ? stop : start)(li);
    };
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  private stopImpressions() {
    this.observer?.disconnect();
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.visible.clear();
    if (this.onVisibility) document.removeEventListener('visibilitychange', this.onVisibility);
  }
}

/**
 * Loads and decodes the story each of the first groups opens on, so tapping a circle opens it at
 * once. Loaded on the tap instead, a story not yet in the browser opened on black and a spinner.
 * The images are returned to be held on to, which keeps them decoded.
 */
function preloadFirstStories(groups: readonly FeedGroupDto[], seen: SeenStore): HTMLImageElement[] {
  return groups.slice(0, PRELOAD_GROUPS).flatMap((g) => {
    const first = g.stories[seen.firstUnseenIndex(g)];
    if (first?.type !== 'image') return [];
    const img = new Image();
    img.src = first.url;
    img.decode?.().catch(() => {});
    return [img];
  });
}

/** Loads and decodes the first covers, giving up after a moment on a slow network. */
function preloadCovers(groups: readonly FeedGroupDto[]): Promise<unknown> {
  const covers = groups.slice(0, 8).map((g) => {
    const img = new Image();
    img.src = g.cover?.image ?? g.coverUrl;
    return img.decode?.().catch(() => {});
  });
  return Promise.race([Promise.all(covers), new Promise((r) => setTimeout(r, REVEAL_WAIT_MS))]);
}
