import { ENERGIZED_PREVIEW_MS, EnergizedCycle, type FeedGroupDto } from '@stories/core';
import { h } from './dom.js';

/** A card counts as visible when (almost) all of it is on screen. */
const FULLY_VISIBLE = 0.95;
/** Wait for scrolling to settle before starting again from the first visible card. */
const SETTLE_MS = 150;
/** The longest a smooth scroll to the next card is waited for. */
const REVEAL_MAX_MS = 1000;

/** A story previewing over a card; added to the bar's styles when previews first start. */
const PREVIEW_CSS = `.ep{position:absolute;inset:0;z-index:1;overflow:hidden;border-radius:inherit;opacity:0;transition:opacity .3s}.ep.on{opacity:1}.ep-media{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}.card .avatar{transition:opacity .3s}.card.previewing .avatar{opacity:0}.ep-media.zoom{animation:ep-zoom ${ENERGIZED_PREVIEW_MS}ms ease-in-out both;will-change:transform}@keyframes ep-zoom{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}@media (prefers-reduced-motion:reduce){.ep{display:none}}`;

/**
 * The Energized style in the browser: previews stories inside the bar's vertical cards, one
 * group at a time (EnergizedCycle decides which), scrolling each card into view for its turn.
 * The card's circle steps aside while its story shows. Videos play muted, images zoom in
 * and out slowly. Previews aren't story views: they send no analytics and mark nothing seen.
 * Paused while the page is hidden, the bar is off screen, or the viewer covers it.
 */
export class EnergizedBar {
  private cycle: EnergizedCycle | null = null;
  private list: HTMLElement | null = null;
  private groups: readonly FeedGroupDto[] = [];
  private cards: IntersectionObserver | null = null;
  private visible = new Set<number>();
  private settle: ReturnType<typeof setTimeout> | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastTick = 0;
  private held = false;
  private shown: { turn: number; el: HTMLElement } | null = null;
  /** The bar is scrolling a card into view for its turn. */
  private revealing = false;
  private revealEnd: ReturnType<typeof setTimeout> | undefined;
  private readonly onVisibility = () => this.update();

  /** Starts (or restarts, after a re-render) on `list`'s cards. */
  start(list: HTMLElement, groups: readonly FeedGroupDto[]): void {
    // Re-rendered with the same stories (e.g. the viewer closed and the rings turned grey): the
    // previews carry on where they were instead of starting again from the first card.
    const kept = this.cycle && sameStories(this.groups, groups) ? this.cycle : null;
    this.stop();
    this.list = list;
    this.groups = groups;
    this.cycle = kept ?? new EnergizedCycle(groups);
    const root = list.getRootNode();
    const styles = root instanceof ShadowRoot ? root : document.head;
    if (!styles.querySelector('style[data-energized]'))
      styles.append(h('style', { 'data-energized': '' }, PREVIEW_CSS));
    if (typeof IntersectionObserver === 'undefined') return;
    this.cards = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const i = Number((e.target as HTMLElement).dataset.energizedIndex);
          if (e.isIntersecting && e.intersectionRatio >= FULLY_VISIBLE) this.visible.add(i);
          else this.visible.delete(i);
        }
        this.settleSoon();
      },
      { threshold: [0, FULLY_VISIBLE, 1] },
    );
    [...list.children].forEach((li, i) => {
      (li as HTMLElement).dataset.energizedIndex = String(i);
      this.cards?.observe(li);
    });
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Once scrolling settles, checks which cards are fully visible. */
  private settleSoon() {
    clearTimeout(this.settle);
    this.settle = setTimeout(() => {
      // Scrolling a card into view for its turn: what's visible is still moving.
      if (this.revealing) return;
      this.tick();
      this.cycle?.setVisible([...this.visible]);
      this.update();
    }, SETTLE_MS);
  }

  /** While the viewer is open: nothing plays behind it. */
  hold(held: boolean): void {
    this.held = held;
    this.update();
  }

  stop(): void {
    clearTimeout(this.settle);
    clearTimeout(this.revealEnd);
    this.revealing = false;
    clearTimeout(this.timer);
    this.cards?.disconnect();
    this.cards = null;
    this.visible.clear();
    this.hide();
    this.cycle = null;
    this.list = null;
    this.lastTick = 0;
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private running(): boolean {
    return !!this.cycle && !this.held && !document.hidden;
  }

  /** Moves the cycle on by the time played since the last tick. */
  private tick() {
    const now = performance.now();
    if (this.lastTick && this.running()) this.cycle?.tick(now - this.lastTick);
    this.lastTick = this.running() ? now : 0;
  }

  /** Shows the cycle's current preview, and wakes up when it should move on. */
  private update() {
    this.tick();
    clearTimeout(this.timer);
    const current = this.running() ? this.cycle?.current() : null;
    if (!current) {
      // The viewer opened (from this card, often): the story stays as it is behind it, paused,
      // rather than going and bringing the circle back as the viewer grows out of the card.
      if (this.held && this.shown) return freeze(this.shown.el, true);
      this.hide();
      return;
    }
    if (this.shown?.turn === current.turn) freeze(this.shown.el, false);
    if (this.shown?.turn !== current.turn) {
      this.hide();
      const story = this.groups[current.groupIndex]?.stories[current.storyIndex];
      const item = this.list?.children[current.groupIndex];
      // Energized cards play over their background; anything else over its cover.
      const card = item?.querySelector('.card-bg') ?? item?.querySelector('.img');
      if (story && card) this.shown = { turn: current.turn, el: showPreview(card, story) };
      if (item instanceof HTMLElement) this.reveal(item);
    }
    this.timer = setTimeout(() => this.update(), this.cycle?.remainingMs() ?? 0);
  }

  /** Scrolls the bar (only the bar, never the page) the least that shows all of `item`. */
  private reveal(item: HTMLElement) {
    const bar = this.list?.parentElement;
    if (!bar) return;
    const box = bar.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const delta =
      r.left < box.left ? r.left - box.left : r.right > box.right ? r.right - box.right : 0;
    if (Math.abs(delta) < 1) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.revealing = true;
    const done = () => {
      clearTimeout(this.revealEnd);
      bar.removeEventListener('scrollend', done);
      this.revealing = false;
      this.settleSoon();
    };
    bar.addEventListener('scrollend', done, { once: true });
    // Browsers without scrollend (or if the bar can't scroll that far): give it a moment.
    clearTimeout(this.revealEnd);
    this.revealEnd = setTimeout(done, REVEAL_MAX_MS);
    bar.scrollBy?.({ left: delta, behavior: reduce ? 'auto' : 'smooth' });
  }

  private hide() {
    if (!this.shown) return;
    const { el } = this.shown;
    this.shown = null;
    el.dataset.gone = '1';
    el.closest('.card')?.classList.remove('previewing');
    el.classList.remove('on');
    el.querySelector('video')?.pause();
    setTimeout(() => el.remove(), 300);
  }
}

/** Pauses a preview where it is (a video, or an image's zoom), or carries it on. */
function freeze(layer: HTMLElement, paused: boolean) {
  const video = layer.querySelector('video');
  if (video) {
    if (paused) video.pause();
    else if (video.paused) void video.play?.()?.catch(() => {});
  }
  const img = layer.querySelector<HTMLElement>('.zoom');
  if (img) img.style.animationPlayState = paused ? 'paused' : '';
}

/** The same groups with the same stories, in the same order. */
function sameStories(a: readonly FeedGroupDto[], b: readonly FeedGroupDto[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (g, i) =>
        g.id === b[i]!.id &&
        g.stories.length === b[i]!.stories.length &&
        g.stories.every((s, j) => s.id === b[i]!.stories[j]!.id),
    )
  );
}

/** Draws a story over a card's cover: a muted video, or an image that zooms in and out. */
function showPreview(card: Element, story: FeedGroupDto['stories'][number]): HTMLElement {
  const layer = h('span', { class: 'ep', 'aria-hidden': 'true' });
  const on = () => {
    // Not once it has been taken away (the next card's turn came first).
    if (layer.dataset.gone) return;
    layer.classList.add('on');
    // The circle gives way to the story.
    card.closest('.card')?.classList.add('previewing');
  };
  if (story.type === 'video') {
    const video = h('video', {
      class: 'ep-media',
      muted: true,
      autoplay: true,
      playsinline: true,
      preload: 'auto',
      disablepictureinpicture: true,
    });
    video.muted = true;
    video.playsInline = true;
    // The cover stays until the video actually plays; if it can't, the cover stays.
    video.addEventListener('playing', on, { once: true });
    video.src = story.url;
    layer.append(video);
    void video.play?.()?.catch(() => {});
  } else {
    const img = h('img', { class: 'ep-media zoom', alt: '', draggable: 'false' });
    img.addEventListener('load', on, { once: true });
    img.src = story.url;
    if (img.complete && img.naturalWidth) on();
    layer.append(img);
  }
  card.append(layer);
  return layer;
}
