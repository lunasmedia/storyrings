import {
  type AnswerResultsDto,
  type AnswerStore,
  actionEvents,
  CLOSED,
  type CloseReason,
  ctaStyle,
  type FeedDto,
  type FeedGroupDto,
  type FeedStoryDto,
  GestureRecognizer,
  isAllowedCtaUrl,
  isSwipeCta,
  labels,
  openViewer,
  progressSegments,
  reduce,
  type SeenStore,
  shareUrl,
  storyLook,
  type TrackedEvent,
  transitionEvents,
  type ViewerAction,
  type ViewerState,
  withoutShareLink,
} from '@stories/core';
import { environment } from './circle.js';
import { h, ICONS, icon } from './dom.js';
import { STICKERS_CSS, Stickers } from './stickers.js';
import { VIEWER_CSS } from './viewer-styles.js';

export interface StoryOpenEvent {
  groupId: string;
  storyId: string;
  groupIndex: number;
  storyIndex: number;
  groupTitle: string;
}

export interface CtaClickEvent {
  url: string;
  label: string;
  groupId: string;
  storyId: string;
  /** Closes the viewer (useful when handling the link in a single-page app). */
  close(): void;
}

export interface ShareEvent {
  /** Link that opens this story on the current page. */
  url: string;
  /** Story name (or the group title). */
  title: string;
  groupId: string;
  storyId: string;
}

export interface ViewerCallbacks {
  /**
   * Called when a viewer taps Share. Return false to handle sharing yourself
   * (e.g. your own share menu); otherwise the SDK opens the device's share
   * sheet, or copies the link where that isn't available.
   */
  onShare?(event: ShareEvent): boolean | undefined;
  onStoryOpen?(event: StoryOpenEvent): void;
  /** Return false to stop the SDK from navigating to the link. */
  onCtaClick?(event: CtaClickEvent): boolean | undefined;
  onClose?(reason: CloseReason): void;
}

/**
 * How the viewer opens and closes. `slide`: up from the bottom; shrinks away towards the bottom.
 * `zoom`: springs out of the clicked circle and goes back into the circle of the group being
 * watched (slides when that circle isn't on screen). With reduced motion, a short fade.
 */
export type StoriesTransition = 'slide' | 'zoom';

/** A circle's place on screen (viewport coordinates) and its corner radius in px. */
export interface CircleRect {
  rect: { left: number; top: number; width: number; height: number };
  radius: number;
}

export interface ViewerOptions extends ViewerCallbacks {
  feed: FeedDto;
  groupIndex: number;
  /** Open at this story of the group (e.g. from a shared link) instead of the first unseen one. */
  startStoryId?: string;
  seen: SeenStore;
  track(event: TrackedEvent): void;
  ctaTarget?: '_self' | '_blank';
  /** Element to focus when the viewer closes (the circle that opened it). */
  returnFocus?: HTMLElement | null;
  /**
   * Render inside this element instead of full-screen. Embedded viewers are not
   * modal: they don't lock page scroll, trap focus or take focus when opening.
   */
  container?: HTMLElement;
  /** How it opens and closes (full-screen viewers only). Default: slide. */
  transition?: StoriesTransition;
  /** Zoom: where group `index`'s circle is on screen, or null when it isn't visible. */
  circle?(index: number): CircleRect | null;
  /** Polls, quizzes and sliders: answers kept on this device, and how to send one. */
  answers?: AnswerStore | null;
  sendAnswer?(
    storyId: string,
    interactionId: string,
    value: number,
  ): Promise<AnswerResultsDto | null>;
  /** Test seams. */
  scheduler?: Scheduler;
  navigate?(url: string, target: '_self' | '_blank'): void;
  /** Page URL shared links point to. Default: the current page. */
  pageUrl?(): string;
  shareApi?: ShareApi;
}

/** The parts of `navigator` used for sharing (Web Share API and clipboard). */
export interface ShareApi {
  share?(data: ShareData): Promise<void>;
  canShare?(data: ShareData): boolean;
  clipboard?: { writeText(text: string): Promise<void> };
}

export interface Scheduler {
  now(): number;
  frame(cb: () => void): number;
  cancel(id: number): void;
}

/** Resolves when an animation ends (or is cancelled). */
function settle(animation: Animation): Promise<void> {
  return animation.finished.then(
    () => undefined,
    () => undefined,
  );
}

const browserScheduler: Scheduler = {
  now: () => performance.now(),
  frame: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

function defaultNavigate(url: string, target: '_self' | '_blank') {
  if (target === '_blank') window.open(url, '_blank', 'noopener');
  else window.location.assign(url);
}

/** Session-wide sound preference: once unmuted, later videos play with sound too. */
let muted = true;

/** Full-screen story viewer rendered in its own shadow root on <body>. */
export class Viewer {
  state: ViewerState = CLOSED;
  private readonly groups: FeedGroupDto[];
  private readonly host = h('div', { 'data-stories-viewer': '' });
  private readonly root: ShadowRoot;
  private readonly el: ReturnType<typeof buildDom>;
  private readonly stickers: Stickers;
  private readonly scheduler: Scheduler;
  private frameId = 0;
  private lastFrame = 0;
  private renderedSeq = -1;
  private mediaEl: HTMLImageElement | HTMLVideoElement | null = null;
  /**
   * The story whose photo or video is on screen: the previous one stays until the next can paint.
   * Its button and stickers go with it, so they never change before the photo does.
   */
  private onScreen: { story: FeedStoryDto; group: FeedGroupDto } | null = null;
  /** Pause reasons: the timer only runs when none apply. */
  private pausedBy = new Set<'user' | 'hold' | 'hidden' | 'share'>();
  private toastTimer: ReturnType<typeof setTimeout> | undefined;
  private swapTimer: ReturnType<typeof setTimeout> | undefined;
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: held so preloads aren't dropped
  private preloaded: HTMLImageElement[] = [];
  private readonly cleanup: (() => void)[] = [];
  private prevOverflow = '';
  private silent = false;
  private readonly embedded: boolean;
  /** The group last shown, so a zoom closes into its circle. */
  private shownGroup = 0;

  constructor(private readonly opts: ViewerOptions) {
    this.groups = opts.feed.groups;
    this.scheduler = opts.scheduler ?? browserScheduler;
    this.root = this.host.attachShadow({ mode: 'open' });
    this.embedded = !!opts.container;
    this.stickers = new Stickers({
      answers: opts.answers ?? null,
      send: (story, id, value) => opts.sendAnswer?.(story, id, value) ?? Promise.resolve(null),
      link: (i) => this.openLink(i.label, i.url),
      hold: (on) => this.setPaused('hold', on),
    });
    this.el = buildDom(this.stickers.el);
    if (this.embedded) {
      this.host.style.cssText = 'position:absolute;inset:0;display:block';
      this.el.backdrop.classList.add('embedded');
      this.el.dialog.setAttribute('role', 'region');
      this.el.dialog.removeAttribute('aria-modal');
    }
    this.el.share.hidden = !opts.feed.app.sharing;
    this.root.append(h('style', {}, VIEWER_CSS + STICKERS_CSS), this.el.backdrop);
    this.bindEvents();

    const start = openViewer(this.groups, opts.groupIndex, {
      startStoryIndex: (g) => {
        const group = this.groups[g]!;
        const linked =
          g === opts.groupIndex && opts.startStoryId
            ? group.stories.findIndex((s) => s.id === opts.startStoryId)
            : -1;
        return linked >= 0 ? linked : opts.seen.firstUnseenIndex(group);
      },
    });
    if (!start.open) return;

    if (opts.container) {
      opts.container.append(this.host);
      this.commit(start);
    } else {
      document.body.append(this.host);
      this.prevOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
      this.commit(start);
      this.el.dialog.focus();
      this.animateIn();
    }
    this.loop();
  }

  get isOpen(): boolean {
    return this.state.open;
  }

  dispatch(action: ViewerAction): void {
    if (!this.state.open) return;
    // Taps, skips and exits; destroy() closes for re-rendering, which isn't the viewer's doing.
    if (!this.silent)
      for (const e of actionEvents(this.state, action, this.groups)) this.opts.track(e);
    const next = this.peek(action);
    if (next !== this.state) this.commit(next);
  }

  /** The state an action would lead to. */
  private peek(action: ViewerAction): ViewerState {
    return reduce(this.state, action, this.groups, {
      startStoryIndex: (g) => this.opts.seen.firstUnseenIndex(this.groups[g]!),
    });
  }

  close(): void {
    this.dispatch({ type: 'CLOSE' });
  }

  /** Removes the viewer without calling onClose (e.g. to re-render a preview). */
  destroy(): void {
    this.silent = true;
    this.close();
  }

  private commit(next: ViewerState) {
    const prev = this.state;
    this.state = next;
    for (const e of transitionEvents(prev, next, this.groups)) this.opts.track(e);

    if (!next.open) return this.teardown(next.closeReason ?? 'user');
    this.shownGroup = next.groupIndex;

    if (next.seq !== this.renderedSeq) {
      this.renderedSeq = next.seq;
      // A hold or user pause doesn't carry over to a new story.
      this.pausedBy.delete('user');
      this.pausedBy.delete('hold');
      this.renderStory();
    }
    this.renderControls();
    this.renderProgress();
  }

  // --- Rendering ------------------------------------------------------------

  private get group(): FeedGroupDto {
    return this.groups[this.state.groupIndex]!;
  }

  private get story(): FeedStoryDto {
    return this.group.stories[this.state.storyIndex]!;
  }

  private renderStory() {
    const { group, story } = this;
    const { el } = this;
    const { storyIndex, groupIndex } = this.state;

    el.dialog.setAttribute('aria-label', labels.viewer(group.title));
    // Each story can have its own name; otherwise it shows the group's title.
    const name = story.title || group.title;
    el.name.textContent = name;
    el.avatar.src = group.cover?.image ?? group.coverUrl;

    // Progress segments for this group.
    if (
      el.progress.childElementCount !== group.stories.length ||
      el.progress.dataset.g !== group.id
    ) {
      el.progress.replaceChildren(
        ...group.stories.map(() => h('div', { class: 'seg' }, h('div', { class: 'fill' }))),
      );
      el.progress.dataset.g = group.id;
    }

    // Media: the new story loads underneath the current one, which stays on screen
    // (paused) until the new one can paint, so skipping never flashes black.
    // A slow load drops it after a moment to show the spinner instead.
    if (this.mediaEl instanceof HTMLVideoElement) this.mediaEl.pause();
    el.spinner.hidden = false;
    const media = story.type === 'video' ? this.createVideo(story) : this.createImage(story);
    // Fill covers the screen; fit shows all of it, with the gaps in the story's colours.
    const look = storyLook(story);
    media.style.objectFit = look.fit === 'fill' ? 'cover' : 'contain';
    // On the story itself, not the container: the previous story stays on screen until this one
    // can paint, and showed this one's gap colours in its own gaps meanwhile.
    media.style.background = look.fill
      ? `linear-gradient(${look.fill.top}, ${look.fill.bottom})`
      : '#000';
    this.mediaEl = media;
    el.media.prepend(media);
    // A designed video's overlay, fitted as the story image would be; shown once it's loaded.
    el.overlay.hidden = true;
    if (look.overlay) {
      const url = look.overlay;
      el.overlay.style.objectFit = media.style.objectFit;
      el.overlay.onload = () => {
        if (el.overlay.src === url) el.overlay.hidden = false;
      };
      el.overlay.src = url;
    } else el.overlay.removeAttribute('src');
    clearTimeout(this.swapTimer);
    this.swapTimer = setTimeout(() => this.dropStale(), 400);
    if (media instanceof HTMLVideoElement) this.playVideo(media);

    // With the previous story still on screen, its button and stickers stay (see dropStale).
    if (el.media.children.length === 1) this.showOverlays();

    el.live.textContent = `${labels.storyPosition(group.title, storyIndex, group.stories.length)}${
      name !== group.title ? `, ${name}` : ''
    }${story.alt ? `. ${story.alt}` : ''}`;

    this.opts.seen.markSeen(story.id);
    this.opts.onStoryOpen?.({
      groupId: group.id,
      storyId: story.id,
      groupIndex,
      storyIndex,
      groupTitle: group.title,
    });
    this.preload();
  }

  /** The current story's button and stickers. */
  private showOverlays() {
    const { story, group, el } = this;
    this.onScreen = { story, group };
    this.stickers.show(story);
    const cta =
      story.cta && isAllowedCtaUrl(story.cta.url, this.opts.feed.app.deepLinkSchemes)
        ? story.cta
        : null;
    const style = ctaStyle(cta?.style);
    el.ctaWrap.hidden = !cta;
    el.ctaWrap.className = `cta-wrap ${style}`;
    el.cta.className = `cta ${style}`;
    el.cta.textContent = cta?.label ?? '';
  }

  private createImage(story: FeedStoryDto): HTMLImageElement {
    const img = h('img', { alt: story.alt, draggable: 'false', decoding: 'async' });
    const seq = this.state.seq;
    const ready = () => this.mediaReady(seq);
    // Decode before showing, so a large photo doesn't paint blank for a frame.
    img.onload = () => img.decode?.().then(ready, ready) ?? ready();
    img.onerror = () => this.mediaFailed(seq);
    img.src = story.url;
    return img;
  }

  private createVideo(story: FeedStoryDto): HTMLVideoElement {
    const video = h('video', {
      playsinline: true,
      'webkit-playsinline': true,
      preload: 'auto',
      'aria-label': story.alt || undefined,
      disablepictureinpicture: true,
    });
    const seq = this.state.seq;
    video.muted = muted;
    video.addEventListener('playing', () => this.mediaReady(seq, video.duration * 1000));
    video.addEventListener('waiting', () => {
      if (seq === this.state.seq) {
        this.el.spinner.hidden = false;
        this.dispatch({ type: 'MEDIA_LOADING' });
      }
    });
    video.addEventListener(
      'ended',
      () => seq === this.state.seq && this.dispatch({ type: 'NEXT', auto: true }),
    );
    video.addEventListener('error', () => this.mediaFailed(seq));
    video.playsInline = true;
    video.src = story.url;
    return video;
  }

  private playVideo(video: HTMLVideoElement) {
    const p = video.play?.();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Autoplay with sound was blocked: fall back to muted playback.
        if (!video.muted) {
          muted = true;
          video.muted = true;
          this.renderControls();
          void video.play()?.catch(() => {});
        }
      });
    }
  }

  private mediaReady(seq: number, durationMs?: number) {
    if (seq !== this.state.seq) return;
    this.el.spinner.hidden = true;
    this.dropStale();
    this.dispatch({ type: 'MEDIA_READY', durationMs });
    this.syncPause();
  }

  private mediaFailed(seq: number) {
    if (seq !== this.state.seq) return;
    this.el.spinner.hidden = true;
    this.mediaEl = null;
    this.dropStale();
    this.el.media.append(h('p', { class: 'error' }, 'This story couldn’t be loaded.'));
    // Let the timer run so the viewer moves on by itself (not counted as a view).
    this.dispatch({ type: 'MEDIA_READY', failed: true });
  }

  /** Fetches and decodes the images a tap or swipe would show next, so they appear at once. */
  private preload() {
    this.preloaded = (['NEXT', 'PREV', 'NEXT_GROUP'] as const).map((type) => {
      const s = this.peek({ type });
      const story = s.open && this.groups[s.groupIndex]!.stories[s.storyIndex];
      const img = new Image();
      if (story && story.type === 'image') {
        img.src = story.url;
        img.decode?.().catch(() => {});
      }
      // Held on to so the browser doesn't drop them before they're needed.
      return img;
    });
  }

  private renderControls() {
    const { el } = this;
    const paused = this.pausedBy.has('user');
    el.pause.setAttribute('aria-label', paused ? labels.play : labels.pause);
    el.pause.replaceChildren(icon(paused ? ICONS.play : ICONS.pause));
    const isVideo = this.story?.type === 'video';
    el.mute.hidden = !isVideo;
    el.mute.setAttribute('aria-label', muted ? labels.unmute : labels.mute);
    el.mute.replaceChildren(icon(muted ? ICONS.muted : ICONS.sound));
  }

  private renderProgress() {
    const fills = this.el.progress.querySelectorAll<HTMLElement>('.fill');
    progressSegments(this.state, this.groups).forEach((v, i) => {
      const fill = fills[i];
      if (fill) fill.style.transform = `scaleX(${v})`;
    });
  }

  // --- Timer ----------------------------------------------------------------

  private loop = () => {
    const now = this.scheduler.now();
    // Clamp so a throttled background tab doesn't skip several stories at once.
    const dt = this.lastFrame ? Math.min(100, now - this.lastFrame) : 0;
    this.lastFrame = now;
    if (dt > 0) this.dispatch({ type: 'TICK', ms: dt });
    if (this.state.open) this.frameId = this.scheduler.frame(this.loop);
  };

  // --- Pause handling -----------------------------------------------------------

  private setPaused(reason: 'user' | 'hold' | 'hidden' | 'share', on: boolean) {
    if (on) this.pausedBy.add(reason);
    else this.pausedBy.delete(reason);
    // A hidden tab or the share sheet takes the story off screen (viewability restarts).
    const offScreen = this.pausedBy.has('hidden') || this.pausedBy.has('share');
    this.dispatch({ type: offScreen ? 'HIDE' : 'SHOW' });
    this.syncPause();
    if (reason === 'user') this.renderControls();
  }

  private syncPause() {
    const shouldPause = this.pausedBy.size > 0;
    this.dispatch({ type: shouldPause ? 'PAUSE' : 'RESUME' });
    this.el.frame.toggleAttribute('data-paused', shouldPause);
    const media = this.mediaEl;
    if (media instanceof HTMLVideoElement) {
      if (shouldPause) media.pause();
      else if (media.paused) this.playVideo(media);
    }
  }

  togglePause() {
    this.setPaused('user', !this.pausedBy.has('user'));
  }

  toggleMute() {
    muted = !muted;
    if (this.mediaEl instanceof HTMLVideoElement) this.mediaEl.muted = muted;
    this.renderControls();
  }

  // --- Events ---------------------------------------------------------------

  private bindEvents() {
    const { el } = this;
    type Events = HTMLElementEventMap & DocumentEventMap;
    const on = <K extends keyof Events>(
      target: EventTarget,
      type: K,
      fn: (e: Events[K]) => void,
    ) => {
      target.addEventListener(type, fn as EventListener);
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
    };

    on(el.close, 'click', () => this.close());
    on(el.pause, 'click', () => this.togglePause());
    on(el.mute, 'click', () => this.toggleMute());
    on(el.cta, 'click', () => this.ctaClicked());
    on(el.share, 'click', () => void this.shareStory());
    // Nav buttons are for keyboard/screen-reader users; pointer taps are handled
    // by the gesture recognizer. Keyboard-generated clicks have detail === 0.
    on(el.prev, 'click', (e) => e.detail === 0 && this.dispatch({ type: 'PREV' }));
    on(el.next, 'click', (e) => e.detail === 0 && this.dispatch({ type: 'NEXT' }));
    // Clicking the dark area around the story (desktop) closes the viewer.
    on(el.dialog, 'click', (e) => e.target === el.dialog && this.close());

    const gestures = new GestureRecognizer({
      onPress: () => this.setPaused('hold', true),
      onRelease: () => this.setPaused('hold', false),
      onTap: (x) => {
        this.setPaused('hold', false);
        this.dispatch({ type: x < 0.3 ? 'PREV' : 'NEXT' });
      },
      onSwipe: (dir) => {
        this.setPaused('hold', false);
        if (dir === 'left') this.dispatch({ type: 'NEXT_GROUP' });
        else if (dir === 'right') this.dispatch({ type: 'PREV_GROUP' });
        else if (dir === 'down') this.close();
        // A swipe-up button: swiping up anywhere on the story opens its link.
        else if (!el.ctaWrap.hidden && isSwipeCta(ctaStyle(this.onScreen?.story.cta?.style))) {
          this.ctaClicked();
        }
      },
      onDrag: (dx, dy) => {
        if (dx !== 0 || dy !== 0) {
          // Dragging down: the story follows the finger and shrinks a little, with rounded corners.
          el.frame.classList.add('dragging');
          const down = Math.max(0, dy);
          el.frame.style.transform =
            down > 0
              ? `translateY(${down}px) scale(${1 - 0.12 * Math.min(1, down / innerHeight)})`
              : '';
          el.frame.style.borderRadius = down > 0 ? '16px' : '';
          return;
        }
        // Let go. A swipe down that closes the viewer follows straight after, and carries on
        // from here; otherwise the story springs back.
        queueMicrotask(() => {
          if (!this.state.open) return;
          el.frame.classList.remove('dragging');
          el.frame.style.transform = '';
          el.frame.style.borderRadius = '';
        });
      },
    });
    const isControl = (e: Event) =>
      e
        .composedPath()
        .some((n) => n instanceof HTMLElement && n.matches('.btn, .cta, .cta-wrap, .sticker'));
    // Positions are relative to the frame's left edge as it was when the finger went down: on
    // larger screens the frame is centred, and the tap position is a fraction of its width.
    let left = 0;
    on(el.frame, 'pointerdown', (e) => {
      if (isControl(e) || e.button > 0) return;
      el.frame.setPointerCapture?.(e.pointerId);
      left = el.frame.getBoundingClientRect().left;
      gestures.down(e.clientX - left, e.clientY, e.timeStamp);
    });
    on(el.frame, 'pointermove', (e) => gestures.move(e.clientX - left, e.clientY));
    on(el.frame, 'pointerup', (e) => {
      gestures.up(e.clientX - left, e.clientY, e.timeStamp, el.frame.getBoundingClientRect().width);
    });
    on(el.frame, 'pointercancel', () => gestures.cancel());
    on(el.frame, 'contextmenu', (e) => e.preventDefault());

    on(el.dialog, 'keydown', (e) => this.onKey(e));
    on(document, 'visibilitychange', () => this.setPaused('hidden', document.hidden));
  }

  private onKey(e: KeyboardEvent) {
    const onButton = e.composedPath()[0] instanceof HTMLButtonElement;
    const actions: Record<string, ViewerAction | (() => void)> = {
      ArrowRight: e.shiftKey ? { type: 'NEXT_GROUP' } : { type: 'NEXT' },
      ArrowLeft: e.shiftKey ? { type: 'PREV_GROUP' } : { type: 'PREV' },
      PageDown: { type: 'NEXT_GROUP' },
      PageUp: { type: 'PREV_GROUP' },
      Escape: () => this.close(),
      k: () => this.togglePause(),
      m: () => this.toggleMute(),
    };
    if (e.key === ' ' && !onButton) actions[' '] = () => this.togglePause();
    if (e.key === 'Tab') return this.embedded ? undefined : this.trapFocus(e);
    const action = actions[e.key];
    if (!action || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof action === 'function') action();
    else this.dispatch(action);
  }

  private trapFocus(e: KeyboardEvent) {
    const focusable = [...this.root.querySelectorAll<HTMLElement>('button')].filter(
      (b) => !b.hidden && !b.closest('[hidden]'),
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = this.root.activeElement;
    if (e.shiftKey && (active === first || active === this.el.dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  private ctaClicked() {
    const cta = this.onScreen?.story.cta;
    if (cta) this.openLink(cta.label, cta.url);
  }

  /** The story button, or a link sticker: both count as a button tap and follow the same rules. */
  private openLink(label: string, url: string) {
    const { story, group } = this.onScreen ?? { story: this.story, group: this.group };
    const cta = { label, url };
    this.opts.track({ type: 'cta_click', groupId: group.id, storyId: story.id });
    const result = this.opts.onCtaClick?.({
      url: cta.url,
      label: cta.label,
      groupId: group.id,
      storyId: story.id,
      close: () => this.close(),
    });
    if (result === false || !this.state.open) return;
    if (!isAllowedCtaUrl(cta.url, this.opts.feed.app.deepLinkSchemes)) return;
    const target = this.opts.ctaTarget ?? '_self';
    if (target === '_blank') this.setPaused('user', true);
    (this.opts.navigate ?? defaultNavigate)(cta.url, target);
  }

  // --- Sharing --------------------------------------------------------------

  private async shareStory() {
    const { story, group } = this;
    const base = this.opts.pageUrl?.() ?? withoutShareLink(window.location.href);
    const url = shareUrl(base, { groupId: group.id, storyId: story.id });
    const title = story.title || group.title;
    const track = () => this.opts.track({ type: 'share', groupId: group.id, storyId: story.id });

    if (this.opts.onShare?.({ url, title, groupId: group.id, storyId: story.id }) === false) {
      track();
      return;
    }

    const api: ShareApi = this.opts.shareApi ?? navigator;
    const data = { title, url };
    // Called straight from the click (no await before it): browsers require a user gesture.
    if (typeof api.share === 'function' && (!api.canShare || api.canShare(data))) {
      this.setPaused('share', true);
      try {
        await api.share(data);
        track();
        return;
      } catch (err) {
        // Dismissing the share sheet is not an error; anything else falls back to copying.
        if ((err as Error)?.name === 'AbortError') return;
      } finally {
        this.setPaused('share', false);
      }
    }
    try {
      if (!api.clipboard) throw new Error('No clipboard');
      await api.clipboard.writeText(url);
      track();
      this.toast(labels.linkCopied);
    } catch {
      this.toast(labels.shareFailed);
    }
  }

  private toast(text: string) {
    if (!this.state.open) return;
    const { toast } = this.el;
    toast.textContent = text;
    toast.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.hidden = true;
    }, 2200);
  }

  // --- Teardown -------------------------------------------------------------

  /** Removes every media element except the current story's. */
  private dropStale() {
    for (const m of [...this.el.media.children]) {
      if (m === this.mediaEl) continue;
      if (m instanceof HTMLVideoElement) {
        m.pause();
        m.removeAttribute('src');
        m.load?.();
      }
      m.remove();
    }
    if (this.state.open && this.onScreen?.story !== this.story) this.showOverlays();
  }

  private teardown(reason: CloseReason) {
    this.scheduler.cancel(this.frameId);
    clearTimeout(this.toastTimer);
    clearTimeout(this.swapTimer);
    this.dropStale();
    for (const fn of this.cleanup.splice(0)) fn();
    this.stickers.destroy();
    const hadFocus = this.root.activeElement !== null;
    const done = () => {
      this.mediaEl = null;
      if (!this.embedded) document.documentElement.style.overflow = this.prevOverflow;
      this.host.remove();
      if (this.silent) return;
      if (!this.embedded || hadFocus) this.opts.returnFocus?.focus();
      this.opts.onClose?.(reason);
    };
    const leaving = this.silent ? null : this.animateOut();
    if (leaving) void leaving.then(done);
    else done();
  }

  // --- Opening and closing motion -------------------------------------------

  /** Full-screen viewers animate; embedded ones (and browsers without Web Animations) don't. */
  private get animates(): boolean {
    return !this.embedded && typeof this.el.frame.animate === 'function';
  }

  /** The frame's place without any drag transform (the backdrop is fixed to the viewport). */
  private frameRect() {
    const f = this.el.frame;
    return { left: f.offsetLeft, top: f.offsetTop, width: f.offsetWidth, height: f.offsetHeight };
  }

  private frameRadius(): number {
    return Number.parseFloat(getComputedStyle(this.el.frame).borderTopLeftRadius) || 0;
  }

  /** The frame shrunk onto a circle: scaled to its width, clipped to its height, centred on it. */
  private onCircle(c: CircleRect): Keyframe {
    const to = this.frameRect();
    const scale = c.rect.width / to.width;
    const dx = c.rect.left + c.rect.width / 2 - (to.left + to.width / 2);
    const dy = c.rect.top + c.rect.height / 2 - (to.top + to.height / 2);
    const inset = Math.max(0, (to.height - c.rect.height / scale) / 2);
    return {
      transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
      clipPath: `inset(${inset}px 0px round ${c.radius / scale}px)`,
    };
  }

  private animateIn() {
    if (!this.animates) return;
    // The first frames lay out the story and decode its image; starting the motion after them
    // keeps that cost out of it. Until then the viewer is drawn but invisible.
    const host = this.host;
    host.style.opacity = '0';
    this.scheduler.frame(() =>
      this.scheduler.frame(() => {
        host.style.opacity = '';
        if (this.state.open) this.playIn();
      }),
    );
  }

  private playIn() {
    const { frame, backdrop } = this.el;
    if (environment().reducedMotion) {
      backdrop.animate([{ opacity: 0 }, { opacity: 1 }], 150);
      return;
    }
    const from =
      this.opts.transition === 'zoom' ? (this.opts.circle?.(this.state.groupIndex) ?? null) : null;
    const duration = from ? 480 : 300;
    // The dim behind a desktop frame (phones: none, the page shows around the story).
    backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration, easing: 'ease-out' });
    if (from) {
      // Springs out of the circle.
      frame.animate(
        [
          this.onCircle(from),
          { transform: 'none', clipPath: `inset(0px round ${this.frameRadius()}px)` },
        ],
        {
          duration,
          easing: 'cubic-bezier(0.3, 1.18, 0.5, 1)',
        },
      );
    } else {
      frame.animate(
        [
          { transform: `translateY(${innerHeight - this.frameRect().top}px)` },
          { transform: 'none' },
        ],
        {
          duration,
          easing: 'cubic-bezier(0.2, 0, 0, 1)',
        },
      );
    }
  }

  /**
   * Back into the circle of the group being watched (zoom), or shrinks towards the bottom of
   * the screen; from wherever a drag left the frame. Null when there's nothing to animate.
   */
  private animateOut(): Promise<void> | null {
    if (!this.animates) return null;
    const { frame, backdrop } = this.el;
    const opts = { fill: 'forwards' as const };
    if (environment().reducedMotion) {
      backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, ...opts });
      return settle(
        frame.animate([{ opacity: frame.style.opacity || '1' }, { opacity: 0 }], {
          duration: 150,
          ...opts,
        }),
      );
    }
    // Carries on from the drag: its transform and fade are the first frame.
    const from: Keyframe = {
      transform: frame.style.transform || 'none',
      clipPath: `inset(0px round ${this.frameRadius()}px)`,
    };
    const startOpacity = '1';
    frame.classList.remove('dragging');
    const into =
      this.opts.transition === 'zoom' ? (this.opts.circle?.(this.shownGroup) ?? null) : null;
    const duration = into ? 380 : 300;
    let to: Keyframe;
    if (into) {
      to = this.onCircle(into);
    } else {
      const r = this.frameRect();
      const scale = 0.12;
      to = {
        transform: `translate(0px, ${innerHeight * 0.92 - (r.top + r.height / 2)}px) scale(${scale})`,
        clipPath: `inset(0px round ${16 / scale}px)`,
      };
    }
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration, ...opts });
    const motion = frame.animate([from, to], {
      duration,
      easing: into ? 'cubic-bezier(0.35, 0, 0.15, 1)' : 'cubic-bezier(0.4, 0, 0.2, 1)',
      ...opts,
    });
    // Fades at the end: into the circle's cover, or as it gets small.
    const fadeFrom = into ? 0.75 : 0.6;
    frame.animate(
      [
        { opacity: startOpacity, offset: 0 },
        { opacity: startOpacity, offset: fadeFrom },
        { opacity: 0, offset: 1 },
      ],
      { duration, ...opts },
    );
    return settle(motion);
  }
}

function buildDom(stickers: HTMLElement) {
  const btn = (cls: string, label: string, paths: string) =>
    h('button', { type: 'button', class: `btn ${cls}`, 'aria-label': label }, icon(paths));

  const progress = h('div', { class: 'progress', 'aria-hidden': 'true' });
  const avatar = h('img', { class: 'avatar', alt: '' });
  const name = h('span', { class: 'name' });
  const share = btn('share', labels.share, ICONS.share);
  const pause = btn('pause', labels.pause, ICONS.pause);
  const mute = btn('mute', labels.unmute, ICONS.muted);
  const close = btn('close', labels.close, ICONS.close);
  const media = h('div', { class: 'media' });
  // A designed video's text and stickers, over the video.
  const overlay = h('img', { class: 'overlay', alt: '', hidden: true }) as HTMLImageElement;
  const spinner = h('div', { class: 'spinner', 'aria-hidden': 'true' });
  const prev = h('button', { type: 'button', class: 'nav prev', 'aria-label': labels.previous });
  const next = h('button', { type: 'button', class: 'nav next', 'aria-label': labels.next });
  const cta = h('button', { type: 'button', class: 'cta' });
  const ctaWrap = h('div', { class: 'cta-wrap', hidden: true }, cta);
  const live = h('div', { class: 'sr', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const toast = h('div', { class: 'toast', role: 'status', hidden: true });
  const frame = h(
    'div',
    { class: 'frame' },
    media,
    overlay,
    spinner,
    h('div', { class: 'shade' }),
    progress,
    prev,
    next,
    stickers,
    h('div', { class: 'header' }, avatar, name, share, pause, mute, close),
    ctaWrap,
    toast,
    live,
  );
  const dialog = h(
    'div',
    { class: 'dialog', role: 'dialog', 'aria-modal': 'true', tabindex: '-1' },
    frame,
  );
  const backdrop = h('div', { class: 'backdrop' }, dialog);
  return {
    backdrop,
    dialog,
    frame,
    media,
    overlay,
    spinner,
    progress,
    avatar,
    name,
    share,
    pause,
    mute,
    close,
    prev,
    next,
    cta,
    ctaWrap,
    toast,
    live,
  };
}
