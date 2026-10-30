import {
  AnalyticsQueue,
  type AnswerResultsDto,
  AnswerStore,
  clearViewerId,
  eventsUrl,
  type FeedDto,
  fetchFeed,
  fetchTransport,
  type KeyValueStorage,
  loadViewerId,
  SeenStore,
  sendAnswer,
  type TrackedEvent,
  type Transport,
} from '@stories/core';
import { type MountOptions, type StoriesBarHandle, StoryBar } from './bar.js';
import { resolveTarget } from './dom.js';

declare const __STORIES_VERSION__: string;
declare const __STORIES_API_URL__: string;

export const version: string = __STORIES_VERSION__;
let defaultApiUrl: string = __STORIES_API_URL__;

/** Used by the <script> build to default to the server the script was loaded from. */
export function setDefaultApiUrl(url: string): void {
  defaultApiUrl = url;
}

export interface InitOptions {
  /** Public token from the dashboard (Apps & Websites → your website). */
  token: string;
  /** API base URL. Defaults to the server that served stories.js. */
  apiUrl?: string;
  /** Send impression/view/click analytics. Default true. */
  analytics?: boolean;
  /** Where "seen" state and the last feed (for an instant bar on reload) are stored. Defaults to localStorage; null disables it. */
  storage?: KeyValueStorage | null;
  /**
   * Count unique viewers (reach) with an anonymous ID kept in `storage`. Default true.
   * Pass false until the visitor consents if your privacy rules require it, then call
   * `setReach(true)`.
   */
  reach?: boolean;
}

/** Sends analytics with fetch, or navigator.sendBeacon when the page is unloading. */
const webTransport: Transport = {
  send(url, body, { beacon }) {
    if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      const ok = navigator.sendBeacon(url, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
      if (ok) return Promise.resolve();
    }
    return fetchTransport.send(url, body, { beacon });
  },
};

/** Tokens that already recorded this page load's page view. */
const pageViewed = new Set<string>();

/** Desktop or mobile web (phones and tablets, including iPads that report a desktop browser). */
export function webPlatform(): 'desktop' | 'mobile_web' {
  if (typeof navigator === 'undefined') return 'desktop';
  const hint = (navigator as { userAgentData?: { mobile?: boolean } }).userAgentData?.mobile;
  if (hint) return 'mobile_web';
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|iPod/i.test(ua)) return 'mobile_web';
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'mobile_web';
  return 'desktop';
}

function safeLocalStorage(): KeyValueStorage | null {
  try {
    const ls = window.localStorage;
    const probe = '__stories__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

export class StoriesClient {
  readonly apiUrl: string;
  /** One feed per story bar key ('' = the main bar) and tags, shared by the bars showing it. */
  private feedPromises = new Map<string, Promise<FeedDto>>();
  private seenStores = new Map<string, Promise<SeenStore>>();
  private answerStores = new Map<string, Promise<AnswerStore>>();
  private queue: AnalyticsQueue | null = null;
  private bars = new Set<StoryBar>();
  private readonly onPageHide = () => this.queue?.flush({ beacon: true });
  private readonly onVisibility = () => {
    if (document.visibilityState === 'hidden') void this.queue?.flush({ beacon: true });
  };

  constructor(readonly options: InitOptions) {
    if (!options?.token) throw new Error('Stories: init({ token }) requires your public token');
    this.apiUrl = (options.apiUrl ?? defaultApiUrl).replace(/\/$/, '');
    if (options.analytics !== false) {
      this.queue = new AnalyticsQueue({
        url: eventsUrl(this.apiUrl, options.token),
        sdk: `web@${version}`,
        transport: webTransport,
        viewer: () => this.viewerId,
        platform: webPlatform(),
        // Selenium, Puppeteer, Playwright…: flagged so the server filters it as invalid traffic.
        automation: typeof navigator !== 'undefined' && navigator.webdriver === true,
      });
      if (options.reach !== false) this.setReach(true);
      // One page view per page load and token, however many bars or clients use it.
      if (!pageViewed.has(options.token)) {
        pageViewed.add(options.token);
        this.trackPageView();
      }
      addEventListener('pagehide', this.onPageHide);
      document.addEventListener('visibilitychange', this.onVisibility);
    }
  }

  /**
   * Records a page view. Called automatically when the page loads; single-page apps
   * call it on each route change.
   */
  trackPageView(): void {
    this.queue?.track({ type: 'page_view' });
  }

  private viewerId: string | null = null;
  private reachOn = false;

  /**
   * Turns unique-viewer counting on or off, e.g. when a visitor gives or withdraws
   * consent. Turning it off also deletes the stored anonymous ID.
   */
  setReach(enabled: boolean): void {
    this.reachOn = enabled && !!this.queue;
    if (!this.reachOn) {
      this.viewerId = null;
      void clearViewerId(this.storage);
      return;
    }
    void loadViewerId(this.storage).then((id) => {
      if (this.reachOn) this.viewerId = id;
    });
  }

  private get storage(): KeyValueStorage | null {
    return this.options.storage === undefined ? safeLocalStorage() : this.options.storage;
  }

  private feedKey(bar = '', tags: readonly string[] = []): string {
    return `stories:feed:${this.options.token}${bar ? `:${bar}` : ''}${tags.length ? `#${tags.join(',')}` : ''}`;
  }

  /**
   * Fetches a story bar's feed once and shares it between the bars showing it; pass force
   * to refetch. `bar` is the key set in the dashboard; omitted = the main bar. `tags` are the
   * viewer's tags (normalised), for groups with a tag filter.
   */
  loadFeed(force = false, bar = '', tags: readonly string[] = []): Promise<FeedDto> {
    const key = this.feedKey(bar, tags);
    let promise = this.feedPromises.get(key);
    if (force || !promise) {
      const p = fetchFeed({
        apiUrl: this.apiUrl,
        token: this.options.token,
        bar: bar || undefined,
        tags,
      });
      promise = p;
      this.feedPromises.set(key, p);
      p.then(
        // Remembered so the next page load can draw the bar before the network answers.
        (feed) => {
          try {
            void this.storage?.setItem(key, JSON.stringify(feed));
          } catch {}
        },
        // Don't cache failures, so a later mount/refresh can retry.
        () => {
          if (this.feedPromises.get(key) === p) this.feedPromises.delete(key);
        },
      );
    }
    return promise;
  }

  /** A story bar's feed from the previous page load, if any. */
  async cachedFeed(bar = '', tags: readonly string[] = []): Promise<FeedDto | null> {
    try {
      const raw = await this.storage?.getItem(this.feedKey(bar, tags));
      return raw ? (JSON.parse(raw) as FeedDto) : null;
    } catch {
      return null;
    }
  }

  seenStore(appId: string): Promise<SeenStore> {
    let store = this.seenStores.get(appId);
    if (!store) {
      const s = new SeenStore(this.storage, appId);
      store = s.load().then(() => s);
      this.seenStores.set(appId, store);
    }
    return store;
  }

  /** Answers to polls, quizzes and sliders kept on this device (shared by the app's bars). */
  answerStore(appId: string): Promise<AnswerStore> {
    let store = this.answerStores.get(appId);
    if (!store) {
      const s = new AnswerStore(this.storage, appId);
      store = s.load().then(() => s);
      this.answerStores.set(appId, store);
    }
    return store;
  }

  /** Sends an answer to a poll, quiz or slider; resolves to the results, or null if it failed. */
  sendAnswer(body: {
    storyId: string;
    interactionId: string;
    value: number;
  }): Promise<AnswerResultsDto | null> {
    return sendAnswer(
      { apiUrl: this.apiUrl, token: this.options.token },
      { ...body, ...(this.viewerId ? { viewer: this.viewerId } : {}) },
    );
  }

  track(event: TrackedEvent): void {
    this.queue?.track(event);
  }

  /** Renders a story bar into an element (or CSS selector). */
  mount(target: string | Element, options: MountOptions = {}): StoriesBarHandle {
    const bar = new StoryBar(this, resolveTarget(target), options, () => this.bars.delete(bar));
    this.bars.add(bar);
    return bar;
  }

  destroy(): void {
    for (const bar of [...this.bars]) bar.destroy();
    removeEventListener('pagehide', this.onPageHide);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.queue?.dispose();
    this.queue = null;
  }
}

/**
 * Creates a client for your token.
 *
 *   const stories = Stories.init({ token: 'pk_live_…' });
 *   stories.mount('#stories', { onCtaClick: (e) => … });
 */
export function init(options: InitOptions): StoriesClient {
  return new StoriesClient(options);
}
