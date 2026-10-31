import {
  AnalyticsQueue,
  type AnswerResultsDto,
  AnswerStore,
  clearViewerId,
  eventsUrl,
  type FeedDto,
  fetchFeed,
  type KeyValueStorage,
  loadViewerId,
  SeenStore,
  sendAnswer,
  type TrackedEvent,
} from '@stories/core';
import { AppState, type NativeEventSubscription, Platform } from 'react-native';
import { defaultStorage, hasPersistentStorage } from './optional';
import { startsNewSession } from './session';

export const SDK_VERSION = '0.1.1';
/** The hosted Stories API. Pass `apiUrl` to use your own server. */
export const DEFAULT_API_URL = 'https://stories-dashboard.fly.dev';

export interface StoriesClientOptions {
  /** Public token from the dashboard (Apps → your mobile app). */
  token: string;
  /** Stories API base URL. */
  apiUrl?: string;
  /** Send impression/view/click analytics. Default true. */
  analytics?: boolean;
  /**
   * Where "viewed" state and the last feed are kept. Defaults to AsyncStorage when
   * installed (otherwise memory, for this session only); null disables it.
   */
  storage?: KeyValueStorage | null;
  /**
   * Count unique viewers (reach) with an anonymous ID kept in `storage`. Default true.
   * Pass false until the person consents if your privacy rules require it, then call
   * `setReach(true)` on the client. Needs persistent storage (AsyncStorage).
   */
  reach?: boolean;
}

/** Loads the feed and holds per-app state (seen stories, analytics) shared by every bar. */
export class StoriesClient {
  readonly apiUrl: string;
  /** One feed per story bar key ('' = the main bar) and tags, shared by the bars showing it. */
  private feedPromises = new Map<string, Promise<FeedDto>>();
  private seenStores = new Map<string, Promise<SeenStore>>();
  private answerStores = new Map<string, Promise<AnswerStore>>();
  private queue: AnalyticsQueue | null = null;
  private appState: NativeEventSubscription | null = null;

  constructor(readonly options: StoriesClientOptions) {
    if (!options?.token) throw new Error('Stories: a public token is required');
    this.apiUrl = (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, '');
    if (options.analytics !== false) {
      this.queue = new AnalyticsQueue({
        url: eventsUrl(this.apiUrl, options.token),
        sdk: `react-native@${SDK_VERSION}`,
        viewer: () => this.viewerId,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      });
      if (options.reach !== false) this.setReach(true);
      // Send what's queued before the app may be suspended.
      // A session starts now, and again after 30+ minutes away (the Firebase rule).
      this.queue.track({ type: 'app_open' });
      this.appState = AppState.addEventListener('change', (s) => {
        if (s === 'active') {
          if (startsNewSession(this.leftAt, Date.now())) {
            this.queue?.track({ type: 'app_open' });
          }
          this.leftAt = null;
        } else {
          this.leftAt ??= Date.now();
          void this.queue?.flush({ beacon: true });
        }
      });
    }
  }

  private leftAt: number | null = null;
  private viewerId: string | null = null;
  private reachOn = false;

  /**
   * Turns unique-viewer counting on or off, e.g. when someone gives or withdraws
   * consent. Turning it off also deletes the stored anonymous ID.
   */
  setReach(enabled: boolean): void {
    // A memory-only ID would reset every launch and count the same person many times.
    const persistent = this.options.storage !== undefined || hasPersistentStorage;
    this.reachOn = enabled && !!this.queue && persistent;
    if (!this.reachOn) {
      this.viewerId = null;
      if (!enabled) void clearViewerId(this.storage);
      return;
    }
    void loadViewerId(this.storage).then((id) => {
      if (this.reachOn) this.viewerId = id;
    });
  }

  private get storage(): KeyValueStorage | null {
    return this.options.storage === undefined ? defaultStorage : this.options.storage;
  }

  private feedKey(bar = '', tags: readonly string[] = []): string {
    return `stories:feed:${this.options.token}${bar ? `:${bar}` : ''}${tags.length ? `#${tags.join(',')}` : ''}`;
  }

  /**
   * Fetches a story bar's feed once and shares it between the bars showing it; pass force
   * to refetch. `bar` is the key set in the dashboard; omitted = the main bar. `tags` are the
   * person's tags (normalised), for groups with a tag filter.
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
        // Remembered so the next launch can lay out the bar before the network answers.
        (feed) => {
          try {
            void Promise.resolve(this.storage?.setItem(key, JSON.stringify(feed))).catch(() => {});
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

  /** A story bar's feed from the previous launch, if any. */
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

  /** Answers to polls, quizzes and sliders kept on this device. */
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

  destroy(): void {
    this.appState?.remove();
    this.queue?.dispose();
    this.queue = null;
  }
}

const clients = new Map<string, StoriesClient>();

/**
 * Starts the SDK when the app launches, so app sessions and active users are counted
 * even before (or without) a story bar on screen. Bars with the same options share it.
 *
 *   startStories({ token: 'pk_live_…', apiUrl: 'https://stories.example.com' });
 */
export function startStories(options: StoriesClientOptions): StoriesClient {
  return getClient(options);
}

/** One client per token/API URL/analytics setting, shared by every bar in the app. */
export function getClient(options: StoriesClientOptions): StoriesClient {
  const key = `${options.token}|${options.apiUrl ?? ''}|${options.analytics !== false}`;
  let client = clients.get(key);
  if (!client || (options.storage !== undefined && client.options.storage !== options.storage)) {
    client?.destroy();
    client = new StoriesClient(options);
    clients.set(key, client);
  }
  return client;
}
