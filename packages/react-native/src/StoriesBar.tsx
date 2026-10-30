import { normalizeTags } from '@stories/contracts/tags';
import {
  type AnswerStore,
  type FeedDto,
  type FeedGroupDto,
  labels,
  resolveTheme,
  type SeenStore,
  StoriesError,
  type StoriesTheme,
  type TrackedEvent,
} from '@stories/core';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Dimensions,
  Image,
  Pressable,
  ScrollView,
  type StyleProp,
  useColorScheme,
  type View,
  type ViewStyle,
} from 'react-native';
import { Circle } from './Circle';
import { getClient, type StoriesClientOptions } from './client';
import { badgeSpeech, barMetrics, themeAppearance, visibleItems } from './layout';
import { type CircleRect, type StoriesTransition, Viewer, type ViewerCallbacks } from './Viewer';

export interface StoriesBarProps extends StoriesClientOptions, ViewerCallbacks {
  /**
   * Which story bar to show: its key from the dashboard (Settings → Apps & websites),
   * e.g. "home-feed". Omitted = the main bar.
   */
  bar?: string;
  /**
   * Tags for the person using the app (e.g. ['london', 'premium']), from your own user data.
   * Story groups with a tag filter (Edit group → Audience) only show to people whose tags pass it.
   * Use labels for groups of people, never personal data such as emails or IDs. Changing
   * them (e.g. after sign-in) reloads the feed.
   */
  tags?: readonly string[];
  theme?: Partial<StoriesTheme>;
  /**
   * Colour of the screen behind the bar, used for the gap between ring and
   * image. Defaults to white, or black in dark mode.
   */
  backgroundColor?: string;
  /**
   * How the viewer opens and closes: `'slide'` (default: up from the bottom, shrinking away
   * towards the bottom) or `'zoom'` (out of the tapped circle and back into it).
   */
  transition?: StoriesTransition;
  /** Called with the published groups once loaded (may be empty). */
  onLoad?(groups: FeedGroupDto[]): void;
  /** Called if the feed can't be loaded. The bar then renders nothing. */
  onFail?(error: StoriesError): void;
  style?: StyleProp<ViewStyle>;
}

export interface StoriesBarHandle {
  /** Published groups currently shown. */
  readonly groups: readonly FeedGroupDto[];
  /** Opens the viewer at a group (by id or index). Returns false if not found. */
  open(group: string | number): boolean;
  close(): void;
  /** Refetches the feed and re-renders. */
  refresh(): Promise<void>;
}

/** How many groups, from the start of the bar, have their first story fetched with the feed. */
const PREFETCH_GROUPS = 4;

/**
 * Fetches the story each of the first groups opens on, so tapping a circle opens it at once.
 * Fetched on the tap instead, a story not yet on the device kept the viewer from opening.
 */
function prefetchFirstStories(groups: readonly FeedGroupDto[], seen: SeenStore) {
  for (const g of groups.slice(0, PREFETCH_GROUPS)) {
    const first = g.stories[seen.firstUnseenIndex(g)];
    if (first?.type === 'image') Image.prefetch(first.url).catch(() => {});
  }
}

/** Viewability: how long a circle must stay at least half on screen to count as an impression. */
const VIEWABLE_MS = 1000;
/** Longest the bar stays hidden on launch while waiting for the live feed and covers. */
const REVEAL_WAIT_MS = 500;

/**
 * Instagram-style story bar. Tapping a circle opens the full-screen viewer.
 *
 *   <StoriesBar token="pk_live_…" apiUrl="https://stories.example.com" />
 *   <StoriesBar token="pk_live_…" bar="product-page" />   (a second story bar)
 */
export const StoriesBar = forwardRef<StoriesBarHandle, StoriesBarProps>(
  function StoriesBar(props, ref) {
    const { token, apiUrl, analytics, storage, style, reach } = props;
    const bar = props.bar?.trim().toLowerCase() ?? '';
    // Compared by value, so a new array with the same tags doesn't reload the feed.
    const tagsKey = normalizeTags(props.tags).join(',');
    const tags = useMemo(() => (tagsKey ? tagsKey.split(',') : []), [tagsKey]);
    // `reach` changes are applied below without making a new client.
    // biome-ignore lint/correctness/useExhaustiveDependencies: see above
    const client = useMemo(
      () => getClient({ token, apiUrl, analytics, storage, reach }),
      [token, apiUrl, analytics, storage],
    );
    // Story events say which bar they came from, so analytics can be split by bar.
    const track = useCallback(
      (e: TrackedEvent) => client.track(bar && 'groupId' in e ? { ...e, bar } : e),
      [client, bar],
    );
    const reachRef = useRef(reach);
    useEffect(() => {
      if (reachRef.current === reach) return;
      reachRef.current = reach;
      client.setReach(reach !== false);
    }, [client, reach]);
    const latest = useRef(props);
    latest.current = props;

    const [feed, setFeed] = useState<FeedDto | null>(null);
    const [seen, setSeen] = useState<SeenStore | null>(null);
    const [answers, setAnswers] = useState<AnswerStore | null>(null);
    const [failed, setFailed] = useState(false);
    const [visible, setVisible] = useState(false);
    const [viewer, setViewer] = useState<number | null>(null);
    const [pressed, setPressed] = useState<number | null>(null);
    // The circle tapped to open the viewer, shown pressed until the viewer shows.
    const [opening, setOpening] = useState<number | null>(null);
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    const [reducedMotion, setReducedMotion] = useState(false);
    const opacity = useRef(new Animated.Value(0)).current;
    const fresh = useRef(false);
    /** The feed on screen (live or remembered), for deciding what to do when loading fails. */
    const shown = useRef<FeedDto | null>(null);
    /** The last load failed for a temporary reason (offline, server error). */
    const retry = useRef(false);
    const impressed = useRef(new Set<string>());
    /** Circles on screen, waiting out the viewability second. */
    const pending = useRef(new Map<string, ReturnType<typeof setTimeout>>());
    const appActive = useRef(AppState.currentState === 'active');
    const scroll = useRef({ offset: 0, viewport: 0 });

    const scheme = useColorScheme();
    const background = props.backgroundColor ?? (scheme === 'dark' ? '#000000' : '#ffffff');
    const textColor = scheme === 'dark' ? '#ffffff' : '#111111';
    const themeKey = JSON.stringify(props.theme ?? {});
    // biome-ignore lint/correctness/useExhaustiveDependencies: compared by value
    const theme = useMemo(() => resolveTheme(props.theme), [themeKey]);
    const metrics = barMetrics(theme, feed?.app.layout);
    const fallback = useMemo(() => themeAppearance(theme), [theme]);
    const groups = feed?.groups ?? [];

    useEffect(() => {
      let active = true;
      AccessibilityInfo.isReduceMotionEnabled().then((on) => active && setReducedMotion(on));
      const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReducedMotion);
      return () => {
        active = false;
        sub.remove();
      };
    }, []);

    const reveal = useCallback(() => {
      setVisible((was) => {
        if (!was) {
          Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
        }
        return true;
      });
    }, [opacity]);

    const load = useCallback(
      async (force: boolean, isCurrent: () => boolean) => {
        try {
          const next = await client.loadFeed(force, bar, tags);
          const store = await client.seenStore(next.app.id);
          if (!isCurrent()) return;
          // Show new covers only once they're loaded, so they don't pop in.
          await Promise.race([
            Promise.all(
              next.groups
                .slice(0, 8)
                .map((g) => Image.prefetch(g.cover?.image ?? g.coverUrl).catch(() => {})),
            ),
            new Promise((r) => setTimeout(r, REVEAL_WAIT_MS)),
          ]);
          if (!isCurrent()) return;
          fresh.current = true;
          retry.current = false;
          shown.current = next;
          setFeed((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
          setSeen(store);
          prefetchFirstStories(next.groups, store);
          setAnswers(await client.answerStore(next.app.id));
          setFailed(false);
          reveal();
          latest.current.onLoad?.(next.groups);
        } catch (err) {
          if (!isCurrent()) return;
          const error =
            err instanceof StoriesError
              ? err
              : new StoriesError('network', (err as Error)?.message ?? 'Unknown error');
          // Offline or a server hiccup: keep showing the stories from the last launch, and
          // try again when the app comes back to the foreground. Anything else hides the bar.
          const temporary = error.code === 'network' || error.code === 'server';
          retry.current = temporary;
          if (temporary && shown.current) reveal();
          else setFailed(true);
          if (latest.current.onFail) latest.current.onFail(error);
          else console.warn(`[Stories] ${error.message}`);
        }
      },
      [client, bar, tags, reveal],
    );

    useEffect(() => {
      let current = true;
      fresh.current = false;
      shown.current = null;
      retry.current = false;
      impressed.current.clear();
      // Lay out the bar from the previous launch's feed (hidden) while the live one loads;
      // it shows if the network is slow.
      client.cachedFeed(bar, tags).then(async (cached) => {
        if (!cached || !current) return;
        const store = await client.seenStore(cached.app.id);
        if (!current || fresh.current) return;
        shown.current = cached;
        setFeed(cached);
        setSeen(store);
        setAnswers(await client.answerStore(cached.app.id));
      });
      const timer = setTimeout(() => current && reveal(), REVEAL_WAIT_MS);
      void load(false, () => current);
      return () => {
        current = false;
        clearTimeout(timer);
      };
    }, [client, bar, tags, load, reveal]);

    useEffect(() => {
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active' && retry.current) void load(true, () => true);
      });
      return () => sub.remove();
    }, [load]);

    // Countdown badges change at most once a minute.
    useEffect(() => {
      if (!groups.some((g) => g.appearance?.badge.type === 'countdown' && g.endsAt)) return;
      const timer = setInterval(rerender, 60_000);
      return () => clearInterval(timer);
    }, [groups]);

    /**
     * One impression per group per mount, by the MRC/IAB viewability rule: at least
     * half of the circle on screen for one continuous second, while the app is in the
     * foreground and the viewer isn't covering the bar.
     */
    const reportImpressions = useCallback(() => {
      const onScreen = new Set<string>();
      const { offset, viewport } = scroll.current;
      if (fresh.current && feed && visible && viewport && viewer === null && appActive.current) {
        for (const i of visibleItems(feed.groups.length, metrics, offset, viewport)) {
          const id = feed.groups[i]?.id;
          if (id && !impressed.current.has(id)) onScreen.add(id);
        }
      }
      const timers = pending.current;
      for (const [id, timer] of timers) {
        if (!onScreen.has(id)) {
          clearTimeout(timer);
          timers.delete(id);
        }
      }
      for (const id of onScreen) {
        if (timers.has(id)) continue;
        timers.set(
          id,
          setTimeout(() => {
            timers.delete(id);
            if (impressed.current.has(id)) return;
            impressed.current.add(id);
            track({ type: 'impression', groupId: id });
          }, VIEWABLE_MS),
        );
      }
    }, [track, feed, metrics, visible, viewer]);

    useEffect(() => {
      reportImpressions();
    }, [reportImpressions]);

    useEffect(() => {
      const sub = AppState.addEventListener('change', (state) => {
        appActive.current = state === 'active';
        reportImpressions();
      });
      return () => sub.remove();
    }, [reportImpressions]);

    useEffect(() => {
      const timers = pending.current;
      return () => {
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
      };
    }, []);

    // Each circle's view, to find where it is on screen for the zoom transition.
    const items = useRef(new Map<string, View>());
    const [openFrom, setOpenFrom] = useState<CircleRect | null>(null);
    // Closing from code goes through the viewer, so it animates closed and reports the exit.
    const [closeSignal, setCloseSignal] = useState(0);

    /** Group `index`'s circle on screen, if at least half of it is visible. */
    const circle = useCallback(
      (index: number) =>
        new Promise<CircleRect | null>((resolve) => {
          const view = groups[index] && items.current.get(groups[index]!.id);
          if (!view) return resolve(null);
          view.measureInWindow((x, y, w, _h) => {
            // The item is the circle with its title below; the circle is centred at the top.
            const rect = {
              x: x + (w - metrics.width) / 2,
              y,
              width: metrics.width,
              height: metrics.height,
            };
            const win = Dimensions.get('window');
            const shown = Math.min(rect.x + rect.width, win.width) - Math.max(rect.x, 0);
            const visible =
              shown >= rect.width / 2 && rect.y + rect.height > 0 && rect.y < win.height;
            resolve(visible ? { ...rect, radius: Math.min(metrics.radius, rect.width / 2) } : null);
          });
        }),
      [groups, metrics],
    );

    const open = useCallback(
      (group: string | number) => {
        const index = typeof group === 'number' ? group : groups.findIndex((g) => g.id === group);
        if (!feed || !seen || index < 0 || index >= groups.length) return false;
        // At once: the viewer itself waits (hidden, briefly) for the first story to draw, and the
        // first stories were fetched with the feed (see prefetchFirstStories).
        const zoom = latest.current.transition === 'zoom' && !reducedMotion;
        setOpening(index);
        void (zoom ? circle(index) : Promise.resolve(null)).then((rect) => {
          setOpenFrom(rect);
          setViewer(index);
        });
        return true;
      },
      [feed, seen, groups, circle, reducedMotion],
    );

    useImperativeHandle(
      ref,
      () => ({
        get groups() {
          return groups;
        },
        open,
        close: () => setCloseSignal((n) => n + 1),
        refresh: () => load(true, () => true),
      }),
      [groups, open, load],
    );

    if (failed || (feed && groups.length === 0)) return null;

    return (
      <Animated.View style={[{ opacity }, style]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="list"
          accessibilityLabel={labels.bar}
          accessibilityElementsHidden={!visible}
          importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
          contentContainerStyle={{ padding: metrics.padding, gap: metrics.gap }}
          // Reserve the bar's height before anything is loaded.
          style={{ minHeight: metrics.height + metrics.padding * 2 + 4 }}
          scrollEventThrottle={100}
          onLayout={(e) => {
            scroll.current.viewport = e.nativeEvent.layout.width;
            reportImpressions();
          }}
          onScroll={(e) => {
            scroll.current.offset = e.nativeEvent.contentOffset.x;
            reportImpressions();
          }}
        >
          {groups.map((g, i) => {
            const isSeen = !!seen?.isGroupSeen(g);
            const appearance = g.appearance ?? fallback;
            return (
              <Pressable
                key={g.id}
                ref={(view) => {
                  if (view) items.current.set(g.id, view as unknown as View);
                  else items.current.delete(g.id);
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  labels.openGroup(g.title, g.stories.length, isSeen) +
                  badgeSpeech(appearance, g.endsAt)
                }
                accessibilityHint="Opens the stories"
                onPress={() => open(i)}
                onPressIn={() => setPressed(i)}
                onPressOut={() => setPressed(null)}
              >
                <Circle
                  group={g}
                  appearance={appearance}
                  seen={isSeen}
                  metrics={metrics}
                  reducedMotion={reducedMotion}
                  background={background}
                  textColor={theme.titleColor === 'currentColor' ? textColor : theme.titleColor}
                  titleFont={theme.titleFont === 'inherit' ? undefined : theme.titleFont}
                  pressed={pressed === i || opening === i}
                />
              </Pressable>
            );
          })}
        </ScrollView>
        {viewer !== null && feed && seen && (
          <Viewer
            feed={feed}
            groupIndex={viewer}
            seen={seen}
            answers={answers}
            sendAnswer={(storyId, interactionId, value) =>
              client.sendAnswer({ storyId, interactionId, value })
            }
            track={track}
            reducedMotion={reducedMotion}
            openFrom={openFrom}
            closeSignal={closeSignal}
            circle={latest.current.transition === 'zoom' ? circle : undefined}
            onStoryOpen={(e) => latest.current.onStoryOpen?.(e)}
            onCtaClick={(e) => latest.current.onCtaClick?.(e)}
            onShare={(e) => latest.current.onShare?.(e)}
            onClose={(reason) => latest.current.onClose?.(reason)}
            onEntered={() => setOpening(null)}
            onDone={() => {
              setOpening(null);
              setViewer(null);
            }}
          />
        )}
      </Animated.View>
    );
  },
);
