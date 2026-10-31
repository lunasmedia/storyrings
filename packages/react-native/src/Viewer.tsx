import {
  type AnswerResultsDto,
  type AnswerStore,
  actionEvents,
  appShareUrl,
  CLOSED,
  type CloseReason,
  ctaStyle,
  type FeedDto,
  type FeedStoryDto,
  GestureRecognizer,
  isAllowedCtaUrl,
  isSwipeCta,
  labels,
  openViewer,
  progressSegments,
  reduce,
  type SeenStore,
  storyLook,
  type TrackedEvent,
  transitionEvents,
  type ViewerAction,
  type ViewerState,
} from '@stories/core';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Image,
  Linking,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  Share,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { CtaButton } from './Cta';
import { CloseIcon, PauseIcon, PlayIcon, ShareIcon, SoundIcon } from './icons';
import { initialInsets, SafeAreaInsetsContext, Video } from './optional';
import { type LinkSticker, Stickers } from './Stickers';

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
  /** Closes the viewer (useful when you handle the link with your own navigation). */
  close(): void;
}

export interface ShareEvent {
  /** The story's link: your share link from the dashboard, with {group} and {story} filled in. */
  url: string;
  /** Story name (or the group title). */
  title: string;
  groupId: string;
  storyId: string;
}

export interface ViewerCallbacks {
  /**
   * Called when someone taps Share (shown when sharing is on in the dashboard). Return false
   * to share yourself; otherwise the SDK opens the phone's share sheet with the link.
   */
  onShare?(event: ShareEvent): boolean | undefined;
  onStoryOpen?(event: StoryOpenEvent): void;
  /** Return false to stop the SDK from opening the link. */
  onCtaClick?(event: CtaClickEvent): boolean | undefined;
  onClose?(reason: CloseReason): void;
}

/**
 * How the viewer opens and closes. `slide`: up from the bottom; shrinks away towards the bottom
 * of the screen. `zoom`: springs out of the tapped circle and goes back into the circle of the
 * group being watched (slides when that circle isn't on screen). With reduced motion, a fade.
 */
export type StoriesTransition = 'slide' | 'zoom';

/** A circle's place on screen (window coordinates) and its corner radius. */
export interface CircleRect {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export interface ViewerProps extends ViewerCallbacks {
  feed: FeedDto;
  groupIndex: number;
  seen: SeenStore;
  track(event: TrackedEvent): void;
  reducedMotion: boolean;
  /** Changes when the app closes the viewer from code. */
  closeSignal?: number;
  /** Zoom: the tapped circle, measured before opening (null = slide). */
  openFrom?: CircleRect | null;
  /** Zoom: finds the circle of a group to close into (null when it isn't on screen). */
  circle?(groupIndex: number): Promise<CircleRect | null>;
  /** Called once the viewer has closed (the bar unmounts it). */
  onDone(reason: CloseReason): void;
  /** The viewer is showing: its first story drew (or stopped waiting for it). */
  onEntered?(): void;
  /** Polls, quizzes and sliders: answers kept on this device, and how to send one. */
  answers?: AnswerStore | null;
  sendAnswer?(
    storyId: string,
    interactionId: string,
    value: number,
  ): Promise<AnswerResultsDto | null>;
}

/** Session-wide sound preference: once unmuted, later videos play with sound too. */
let muted = true;

type PauseReason = 'user' | 'hold' | 'background' | 'share';

interface Layer {
  seq: number;
  story: FeedStoryDto;
  ready: boolean;
  /** Loaded long enough ago to be on screen (see DRAW_MS). */
  drawn: boolean;
  failed: boolean;
}

/**
 * The status bar stays visible over the viewer (the top bar sits below it), with light icons on
 * the dark story. Pushed while the viewer is on screen and popped as it starts closing, so the
 * app's own style comes back. Only the bar style: edge-to-edge apps ignore background colours.
 */
function lightStatusBar(): () => void {
  const entry = StatusBar.pushStackEntry({ barStyle: 'light-content', animated: true });
  return () => StatusBar.popStackEntry(entry);
}

/**
 * An animated value at 0; when `native`, natively driven from the start. Views connect to native
 * animations only if their values are native when they mount: made native by the first animation
 * instead, sometimes after, a story dragged down stayed there while its spring-back ran unseen.
 */
function animatedValue(native: boolean): Animated.Value {
  const value = new Animated.Value(0);
  if (native) Animated.timing(value, { toValue: 0, duration: 0, useNativeDriver: true }).start();
  return value;
}

/** How long the previous story stays up while the next one loads, before the spinner shows. */
const SWAP_WAIT_MS = 400;
/**
 * How long the previous story stays under the next one after the next one has loaded. iOS draws
 * a loaded image a few frames after reporting it (up to ~100 ms for a large photo); removing the
 * previous story at once showed the bare background, black for a photo, in between.
 */
const SETTLE_MS = 250;
/**
 * How long after loading a large photo its button and stickers show: iOS draws one a few frames
 * after reporting it loaded (~70 ms for 2268x4032), and the button came first. Smaller photos and
 * videos draw at once, so theirs show at once.
 */
const DRAW_MS = 100;
/** Photos over this many pixels wait DRAW_MS (a phone screen is about 1.2-1.4 million). */
const LARGE_PIXELS = 4_000_000;
/**
 * Longest opening waits for the first story to draw before it opens on a spinner. Meanwhile the
 * tapped circle stays pressed. The first stories are fetched with the feed, so this is normally
 * only the time to decode the image (~0.1-0.4 s); opening sooner showed black and a spinner.
 */
const OPEN_WAIT_MS = 1500;

/** Full-screen story viewer. Navigation decisions come from the shared state machine. */
export function Viewer(props: ViewerProps) {
  const { feed, seen } = props;
  const groups = feed.groups;
  const latest = useRef(props);
  latest.current = props;
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  // Resolved once a render is on screen (see rendered).
  const onRendered = useRef<(() => void)[]>([]);
  useEffect(() => {
    for (const done of onRendered.current.splice(0)) done();
  });
  /**
   * Re-renders, resolving once that render is on screen. A native animation of styles that are
   * new in it must wait for this: started before, it ran without them and nothing moved.
   */
  const rendered = () =>
    new Promise<void>((done) => {
      onRendered.current.push(done);
      rerender();
    });

  const startOpts = useMemo(
    () => ({ startStoryIndex: (g: number) => seen.firstUnseenIndex(groups[g]!) }),
    [groups, seen],
  );
  const state = useRef<ViewerState>(CLOSED);
  if (!state.current.open && state.current.seq === 0) {
    state.current = openViewer(groups, props.groupIndex, startOpts);
  }
  const layers = useRef<Layer[]>([]);
  const pausedBy = useRef(new Set<PauseReason>());
  // Zoom: the circle the story moves between (null = slide).
  const zoomFrom = useRef<CircleRect | null>(props.reducedMotion ? null : (props.openFrom ?? null));
  // Without a zoom (which animates size and position), the viewer's motion runs natively. Driven
  // from JS, any render in the app (a carousel behind the viewer) redrew it for a frame where it
  // last rendered: the opening viewer flashed back to the bottom of the screen.
  const nativeMotion = useRef(!zoomFrom.current && (props.reducedMotion || !props.circle)).current;
  // The current story's progress bar: a new value for each story (see progressOf).
  const progressBar = useRef<{ seq: number; value: Animated.Value } | null>(null);
  const [drag] = useState(() => animatedValue(nativeMotion));
  const dragNow = useRef(0);
  // Opening: 0 = at the circle / below the screen, 1 = in place (a zoom overshoots a little).
  const [enter] = useState(() => animatedValue(nativeMotion));
  // Slide closing: 0 = where it was, 1 = gone.
  const [exit] = useState(() => animatedValue(nativeMotion));
  // Closing: where a drag left the story (it carries on from there).
  const closingFrom = useRef<number | null>(null);
  const screen = useWindowDimensions();
  // The last open state: what's drawn, including while the viewer animates closed.
  const shown = useRef<ViewerState>(state.current);

  // The viewer stays hidden until the first story can draw (or OPEN_WAIT_MS passes), so it never
  // opens on a black screen. It's still mounted meanwhile, which is what loads the story.
  const entered = useRef(false);
  const startEnter = useRef(() => {});
  const restoreStatusBar = useRef(() => {});
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the viewer opens
  useEffect(() => {
    const id = drag.addListener(({ value }) => {
      dragNow.current = value;
    });
    const wait = setTimeout(() => startEnter.current(), OPEN_WAIT_MS);
    startEnter.current = () => {
      if (entered.current) return;
      entered.current = true;
      clearTimeout(wait);
      latest.current.onEntered?.();
      // Not before: the viewer is invisible until now, over the app's own status bar style.
      if (!closed.current) restoreStatusBar.current = lightStatusBar();
      rerender();
      enterAnimation();
    };
    return () => {
      clearTimeout(wait);
      drag.removeListener(id);
      restoreStatusBar.current();
    };
  }, []);
  /** Opening: a spring out of the circle (zoom), or up from the bottom (slide); a fade with reduced motion. */
  const enterAnimation = () => {
    if (zoomFrom.current) {
      Animated.spring(enter, {
        toValue: 1,
        damping: 20,
        stiffness: 210,
        mass: 1,
        useNativeDriver: nativeMotion,
      }).start();
    } else {
      Animated.timing(enter, {
        toValue: 1,
        duration: props.reducedMotion ? 150 : 300,
        easing: props.reducedMotion ? Easing.linear : Easing.bezier(0.2, 0, 0, 1),
        useNativeDriver: nativeMotion,
      }).start();
    }
  };
  const size = useRef({ width: 1 });
  const swapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const drawTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closed = useRef(false);

  if (state.current.open) shown.current = state.current;
  const group = groups[shown.current.groupIndex]!;
  const story = group.stories[shown.current.storyIndex]!;
  // The story whose photo or video is on screen: the previous one stays up until the next has
  // loaded, and its button and stickers stay with it (they'd change before the photo otherwise).
  // A large photo that has loaded but not yet drawn shows neither story's.
  const top = drawOrder(layers.current).findLast((l) => l.ready || l.failed);
  const onScreen = top?.story ?? story;
  const overlays = !top || top.drawn || top.failed;
  const onScreenGroup = groups.find((g) => g.stories.includes(onScreen)) ?? group;

  // --- State machine ------------------------------------------------------------

  /**
   * The progress bar runs natively from where the timer is, while the timer runs. Set from JS on
   * every tick instead, a re-render of the viewer drew it for a frame where it last rendered.
   */
  const syncProgress = (s: ViewerState) => {
    const at = s.durationMs > 0 ? Math.min(1, s.elapsedMs / s.durationMs) : 0;
    const fresh = progressBar.current?.seq !== s.seq;
    const progress = progressOf(s.seq);
    progress.stopAnimation();
    if (!fresh || at > 0) progress.setValue(at);
    if (s.paused || s.buffering || s.durationMs <= 0 || at >= 1) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: s.durationMs - s.elapsedMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  };

  /**
   * Story `seq`'s progress value, new at 0 for each story. Reset to 0 instead, the next story's bar
   * showed full for a few frames: its view mounted before the reset reached the native side.
   */
  const progressOf = (seq: number) => {
    if (progressBar.current?.seq !== seq) {
      progressBar.current?.value.stopAnimation();
      progressBar.current = { seq, value: animatedValue(true) };
    }
    return progressBar.current.value;
  };

  const peek = (action: ViewerAction) => reduce(state.current, action, groups, startOpts);

  const dispatch = (action: ViewerAction) => {
    const prev = state.current;
    if (!prev.open || closed.current) return;
    for (const e of actionEvents(prev, action, groups)) latest.current.track(e);
    const next = peek(action);
    if (next === prev) return;
    state.current = next;
    for (const e of transitionEvents(prev, next, groups)) latest.current.track(e);
    if (!next.open) return finish(next.closeReason ?? 'user');
    if (
      next.seq !== prev.seq ||
      next.paused !== prev.paused ||
      next.buffering !== prev.buffering ||
      next.durationMs !== prev.durationMs ||
      (action.type !== 'TICK' && next.elapsedMs !== prev.elapsedMs)
    ) {
      syncProgress(next);
    }
    if (next.seq !== prev.seq) {
      // A hold or user pause doesn't carry over to a new story.
      pausedBy.current.delete('user');
      pausedBy.current.delete('hold');
      storyStarted();
      rerender();
    } else if (next.paused !== prev.paused || next.buffering !== prev.buffering) {
      rerender();
    }
  };

  const finish = (reason: CloseReason) => {
    if (closed.current) return;
    closed.current = true;
    clearTimeout(swapTimer.current);
    restoreStatusBar.current();
    restoreStatusBar.current = () => {};
    void animateOut().then(() => {
      latest.current.onDone(reason);
      latest.current.onClose?.(reason);
    });
  };

  /** Back into the circle of the group being watched (zoom), or shrinks towards the bottom. */
  const animateOut = async () => {
    const reduced = latest.current.reducedMotion;
    const into = reduced
      ? null
      : ((await latest.current.circle?.(shown.current.groupIndex)) ?? null);
    enter.stopAnimation();
    // From where the story is now: the drag offset becomes part of the closing motion. The drag
    // value itself is left as it is: resetting it shows on screen at once, a frame before the
    // closing layout (which no longer uses it) is rendered.
    drag.stopAnimation();
    closingFrom.current = reduced ? 0 : dragNow.current;
    if (into && zoomFrom.current) zoomFrom.current = into;
    else zoomFrom.current = null;
    await rendered();
    await new Promise<void>((done) => {
      if (zoomFrom.current) {
        Animated.spring(enter, {
          toValue: 0,
          damping: 26,
          stiffness: 300,
          mass: 1,
          useNativeDriver: nativeMotion,
        }).start(() => done());
      } else {
        Animated.timing(exit, {
          toValue: 1,
          duration: reduced ? 150 : 300,
          easing: reduced ? Easing.linear : Easing.bezier(0.4, 0, 0.2, 1),
          useNativeDriver: nativeMotion,
        }).start(() => done());
      }
    });
  };

  const close = () => {
    if (!state.current.open) return;
    dispatch({ type: 'CLOSE' });
  };

  const openedSignal = useRef(props.closeSignal);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the app asks to close
  useEffect(() => {
    if (props.closeSignal !== openedSignal.current) close();
  }, [props.closeSignal]);

  const syncPause = () => {
    dispatch({ type: pausedBy.current.size > 0 ? 'PAUSE' : 'RESUME' });
  };

  const setPaused = (reason: PauseReason, on: boolean) => {
    if (on) pausedBy.current.add(reason);
    else pausedBy.current.delete(reason);
    // In the background the story is off screen (viewability restarts).
    dispatch({ type: pausedBy.current.has('background') ? 'HIDE' : 'SHOW' });
    syncPause();
    rerender();
  };

  /** Side effects of a story starting: media layer, seen state, callbacks, announcements. */
  const storyStarted = () => {
    const s = state.current;
    const g = groups[s.groupIndex]!;
    const st = g.stories[s.storyIndex]!;
    // The new story loads underneath the current one, which stays visible until the
    // new one can draw, so skipping never flashes black.
    layers.current = [
      { seq: s.seq, story: st, ready: false, drawn: false, failed: false },
      ...layers.current,
    ];
    clearTimeout(settleTimer.current);
    clearTimeout(swapTimer.current);
    swapTimer.current = setTimeout(() => {
      layers.current = layers.current.filter((l) => l.seq === state.current.seq);
      rerender();
    }, SWAP_WAIT_MS);

    seen.markSeen(st.id);
    latest.current.onStoryOpen?.({
      groupId: g.id,
      storyId: st.id,
      groupIndex: s.groupIndex,
      storyIndex: s.storyIndex,
      groupTitle: g.title,
    });
    const name = st.title || g.title;
    AccessibilityInfo.announceForAccessibility(
      `${labels.storyPosition(g.title, s.storyIndex, g.stories.length)}${
        name !== g.title ? `, ${name}` : ''
      }${st.alt ? `. ${st.alt}` : ''}`,
    );
    // Fetch the images a tap or swipe would show next, so they appear at once.
    for (const type of ['NEXT', 'PREV', 'NEXT_GROUP'] as const) {
      const n = peek({ type });
      const target = n.open ? groups[n.groupIndex]?.stories[n.storyIndex] : undefined;
      if (target?.type === 'image') Image.prefetch(target.url).catch(() => {});
    }
  };

  const mediaReady = (seq: number, durationMs?: number) => {
    const layer = layers.current.find((l) => l.seq === seq);
    if (!layer || seq !== state.current.seq) return;
    if (!layer.ready) {
      layer.ready = true;
      clearTimeout(swapTimer.current);
      // Drawn on top now, with the previous story kept underneath until it has surely drawn.
      layers.current = layers.current.filter((l) => l === layer || l.ready);
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => {
        layers.current = layers.current.filter((l) => l.seq === state.current.seq);
        rerender();
      }, SETTLE_MS);
      clearTimeout(drawTimer.current);
      const st = layer.story;
      if (st.type === 'image' && (st.width ?? 0) * (st.height ?? 0) > LARGE_PIXELS) {
        drawTimer.current = setTimeout(() => {
          layer.drawn = true;
          rerender();
        }, DRAW_MS);
      } else {
        layer.drawn = true;
      }
      rerender();
      requestAnimationFrame(() => requestAnimationFrame(() => startEnter.current()));
    }
    dispatch({ type: 'MEDIA_READY', durationMs });
  };

  const mediaFailed = (seq: number) => {
    const layer = layers.current.find((l) => l.seq === seq);
    if (!layer || seq !== state.current.seq) return;
    layer.failed = true;
    clearTimeout(settleTimer.current);
    layers.current = [layer];
    rerender();
    startEnter.current();
    // Let the timer run so the viewer moves on by itself (not counted as a view).
    dispatch({ type: 'MEDIA_READY', failed: true });
  };

  // --- Lifecycle ----------------------------------------------------------------

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once when the viewer opens
  useEffect(() => {
    const first = state.current;
    if (!first.open) return finish('completed');
    for (const e of transitionEvents(CLOSED, first, groups)) latest.current.track(e);
    storyStarted();
    rerender();

    // Timer: one TICK per frame, clamped so a stalled frame doesn't skip stories.
    let frame = 0;
    let last = 0;
    const loop = (now: number) => {
      const dt = last ? Math.min(100, now - last) : 0;
      last = now;
      if (dt > 0) dispatch({ type: 'TICK', ms: dt });
      if (!closed.current) frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    const app = AppState.addEventListener('change', (s) => setPaused('background', s !== 'active'));
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(swapTimer.current);
      clearTimeout(settleTimer.current);
      clearTimeout(drawTimer.current);
      app.remove();
    };
  }, []);

  // --- Gestures -----------------------------------------------------------------

  /** Opens the story button's link when it's a swipe up; set each render. */
  const swipeUp = useRef<(() => void) | null>(null);
  // Built once: the handlers only read refs and stable functions.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const responder = useMemo(() => {
    const gestures = new GestureRecognizer({
      onPress: () => setPaused('hold', true),
      onRelease: () => setPaused('hold', false),
      onTap: (x) => {
        pausedBy.current.delete('hold');
        syncPause();
        dispatch({ type: x < 0.3 ? 'PREV' : 'NEXT' });
      },
      onSwipe: (dir) => {
        pausedBy.current.delete('hold');
        syncPause();
        if (dir === 'left') dispatch({ type: 'NEXT_GROUP' });
        else if (dir === 'right') dispatch({ type: 'PREV_GROUP' });
        else if (dir === 'down') close();
        // A swipe-up button: swiping up anywhere on the story opens its link.
        else swipeUp.current?.();
      },
      onDrag: (dx, dy) => {
        // (0, 0) is the recogniser saying the finger was lifted; anything else is a drag, which
        // the story follows exactly (back to its place when the finger is above where it started).
        const lifted = dx === 0 && dy === 0;
        if (!lifted) {
          drag.stopAnimation();
          drag.setValue(Math.max(0, dy));
        } else if (dragNow.current > 0) {
          // Let go. A swipe down closing the viewer follows straight after; if it doesn't, spring back.
          queueMicrotask(() => {
            if (!closed.current)
              Animated.spring(drag, {
                toValue: 0,
                damping: 20,
                stiffness: 220,
                useNativeDriver: nativeMotion,
              }).start();
          });
        }
      },
    });
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) =>
        gestures.down(e.nativeEvent.pageX, e.nativeEvent.pageY, e.nativeEvent.timestamp),
      onPanResponderMove: (e) => gestures.move(e.nativeEvent.pageX, e.nativeEvent.pageY),
      onPanResponderRelease: (e) =>
        gestures.up(
          e.nativeEvent.pageX,
          e.nativeEvent.pageY,
          e.nativeEvent.timestamp,
          size.current.width,
        ),
      onPanResponderTerminate: () => gestures.cancel(),
    });
  }, []);

  // --- Actions ------------------------------------------------------------------

  const ctaPressed = () => {
    if (onScreen.cta) openLink(onScreen.cta);
  };

  /** The story button, or a link sticker: both count as a button tap and follow the same rules. */
  const openLink = (cta: { label: string; url: string }) => {
    const groupId = onScreenGroup.id;
    const storyId = onScreen.id;
    latest.current.track({ type: 'cta_click', groupId, storyId });
    const result = latest.current.onCtaClick?.({
      url: cta.url,
      label: cta.label,
      groupId,
      storyId,
      close,
    });
    if (result === false || !state.current.open) return;
    if (isAllowedCtaUrl(cta.url, feed.app.deepLinkSchemes)) {
      Linking.openURL(cta.url).catch(() => {});
    }
  };

  // Sharing: on in the dashboard, with the app's share link.
  const shareLink = feed.app.sharing ? feed.app.shareLink : undefined;
  const sharePressed = async () => {
    if (!shareLink) return;
    const url = appShareUrl(shareLink, { groupId: group.id, storyId: story.id });
    const title = story.title || group.title;
    const track = () =>
      latest.current.track({ type: 'share', groupId: group.id, storyId: story.id });
    if (latest.current.onShare?.({ url, title, groupId: group.id, storyId: story.id }) === false) {
      track();
      return;
    }
    // The share sheet covers the story, so it waits.
    setPaused('share', true);
    try {
      const result = await Share.share(
        Platform.OS === 'ios' ? { url, message: title } : { title, message: `${title}\n${url}` },
      );
      if (result.action === Share.sharedAction) track();
    } catch {
      // Nothing to do: the sheet couldn't open.
    } finally {
      if (state.current.open) setPaused('share', false);
    }
  };

  const toggleMute = () => {
    muted = !muted;
    rerender();
  };

  // --- Render -------------------------------------------------------------------

  const s = shown.current;
  const userPaused = pausedBy.current.has('user');
  const name = story.title || group.title;
  const cta =
    overlays && onScreen.cta && isAllowedCtaUrl(onScreen.cta.url, feed.app.deepLinkSchemes)
      ? onScreen.cta
      : null;
  swipeUp.current = cta && isSwipeCta(ctaStyle(cta.style)) ? ctaPressed : null;
  const segments = s.open ? progressSegments(s, groups) : [];
  const insets = useInsets();
  // While the previous story still covers the loading one, no spinner is needed.
  const showSpinner = s.buffering && layers.current.length === 1 && !layers.current[0]?.failed;
  // Kept between renders: a natively driven animation keeps moving the views it started on, and
  // new style nodes on each render left a spring-back after a short drag stuck where it began.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the animated values never change
  const { card, inner } = useMemo(
    () =>
      transitionStyles({
        width: screen.width,
        height: screen.height,
        enter,
        exit,
        drag,
        zoomFrom: zoomFrom.current,
        closingFrom: closingFrom.current,
        reducedMotion: props.reducedMotion,
      }),
    [screen.width, screen.height, zoomFrom.current, closingFrom.current, props.reducedMotion],
  );

  return (
    <Modal
      visible
      transparent
      // The viewer animates itself (see transitionStyles); the app shows around it, never dimmed.
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      supportedOrientations={['portrait']}
      onRequestClose={close}
    >
      {/* Hidden until the first story can draw (see startEnter). */}
      <View
        style={[StyleSheet.absoluteFill, !entered.current && s_.hidden]}
        pointerEvents={entered.current ? 'box-none' : 'none'}
      >
        <Animated.View style={card} pointerEvents="box-none">
          <Animated.View
            style={[s_.root, inner]}
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            onMagicTap={() => setPaused('user', !userPaused)}
            onLayout={(e) => {
              size.current.width = e.nativeEvent.layout.width;
            }}
            {...responder.panHandlers}
          >
            {/* A loading story is drawn under the previous one, which covers it. Once loaded it's
              drawn on top, without a black background while the previous one is still beneath: until
              iOS draws the new image, the previous story shows through rather than black. */}
            {drawOrder(layers.current).map((l) => (
              <Media
                key={l.seq}
                layer={l}
                current={l.seq === s.seq}
                background={!(l.ready && l.seq === s.seq && layers.current.length > 1)}
                paused={s.paused}
                onReady={mediaReady}
                onFailed={mediaFailed}
                onBuffering={(on) => {
                  if (l.seq !== state.current.seq || !l.ready) return;
                  dispatch(on ? { type: 'MEDIA_LOADING' } : { type: 'MEDIA_READY' });
                }}
                onEnd={() => l.seq === state.current.seq && dispatch({ type: 'NEXT', auto: true })}
              />
            ))}
            {showSpinner && <ActivityIndicator style={s_.spinner} color="#fff" size="large" />}
            <View style={s_.shade} pointerEvents="none" />

            {/* Screen-reader controls: double-tap activates; touches pass through to the gestures. */}
            <View
              style={[s_.zone, { left: 0, width: '30%' }]}
              accessible
              accessibilityRole="button"
              accessibilityLabel={labels.previous}
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={() => dispatch({ type: 'PREV' })}
            />
            <View
              style={[s_.zone, { right: 0, width: '70%' }]}
              accessible
              accessibilityRole="button"
              accessibilityLabel={labels.next}
              accessibilityHint={story.alt || undefined}
              accessibilityActions={[{ name: 'activate' }]}
              onAccessibilityAction={() => dispatch({ type: 'NEXT' })}
            />

            {overlays && (
              <Stickers
                story={onScreen}
                width={screen.width}
                height={screen.height}
                answers={props.answers ?? null}
                send={(id, iid, v) =>
                  latest.current.sendAnswer?.(id, iid, v) ?? Promise.resolve(null)
                }
                onLink={(l: LinkSticker) => openLink(l)}
                hold={(on) => setPaused('hold', on)}
              />
            )}

            <View style={[s_.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
              <View
                style={s_.progress}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                {segments.map((v, i) => (
                  <View key={group.stories[i]?.id ?? i} style={s_.seg}>
                    {i === s.storyIndex ? (
                      // A new view per story: one that was driven natively keeps its last
                      // transform when it stops being driven (a finished story showed empty).
                      <Animated.View
                        key={s.seq}
                        style={[
                          s_.fill,
                          s_.running,
                          { transform: [{ scaleX: progressOf(s.seq) }] },
                        ]}
                      />
                    ) : (
                      <View style={[s_.fill, { width: `${v * 100}%` }]} />
                    )}
                  </View>
                ))}
              </View>
              <View style={s_.header} pointerEvents="box-none">
                <Image
                  source={{ uri: group.cover?.image ?? group.coverUrl }}
                  style={s_.avatar}
                  accessibilityIgnoresInvertColors
                />
                <Text style={s_.name} numberOfLines={1} accessibilityRole="header">
                  {name}
                </Text>
                {shareLink && (
                  <IconButton label={labels.share} onPress={() => void sharePressed()}>
                    <ShareIcon />
                  </IconButton>
                )}
                <IconButton
                  label={userPaused ? labels.play : labels.pause}
                  onPress={() => setPaused('user', !userPaused)}
                >
                  {userPaused ? <PlayIcon /> : <PauseIcon />}
                </IconButton>
                {story.type === 'video' && Video && (
                  <IconButton label={muted ? labels.unmute : labels.mute} onPress={toggleMute}>
                    <SoundIcon muted={muted} />
                  </IconButton>
                )}
                <IconButton label={labels.close} onPress={close}>
                  <CloseIcon />
                </IconButton>
              </View>
            </View>

            {cta && (
              <CtaButton
                label={cta.label}
                style={ctaStyle(cta.style)}
                bottom={insets.bottom + 24}
                onPress={ctaPressed}
              />
            )}
          </Animated.View>
        </Animated.View>
      </View>
    </Modal>
  );
}

interface TransitionInput {
  width: number;
  height: number;
  enter: Animated.Value;
  exit: Animated.Value;
  drag: Animated.Value;
  zoomFrom: CircleRect | null;
  closingFrom: number | null;
  reducedMotion: boolean;
}

/**
 * The viewer's position while it opens, closes and is dragged. `card` clips the story; `inner`
 * is the story at screen size. Zoom: the card moves between the circle and the screen, with the
 * story scaled to its width and clipped to its height. Slide: the story slides up, and shrinks
 * towards the bottom centre to close. Dragging down, it follows the finger, shrinking a little
 * with rounded corners; a close carries on from there (`closingFrom`).
 */
function transitionStyles(t: TransitionInput) {
  const { width: W, height: H, enter, exit, drag } = t;
  const full = { position: 'absolute' as const, left: 0, top: 0, width: W, height: H };
  if (t.reducedMotion) {
    return {
      card: { ...full, opacity: t.closingFrom == null ? enter : Animated.subtract(1, exit) },
      inner: null,
    };
  }
  const closing = t.closingFrom != null;
  const d = t.closingFrom ?? 0;
  const dragScale = 1 - 0.12 * Math.min(1, d / H);
  const dragCorner = 16 * Math.min(1, (d / H) * 8);
  // While open (not closing), a drag moves the whole card.
  const dragMotion = closing
    ? []
    : [
        { translateY: drag },
        {
          scale: drag.interpolate({
            inputRange: [0, H],
            outputRange: [1, 0.88],
            extrapolate: 'clamp',
          }),
        },
      ];
  const dragRadius = drag.interpolate({
    inputRange: [0, H / 8],
    outputRange: [0, 16],
    extrapolate: 'clamp',
  });

  const o = t.zoomFrom;
  if (o) {
    const end = {
      x: (W - W * dragScale) / 2,
      y: d + (H - H * dragScale) / 2,
      w: W * dragScale,
      h: H * dragScale,
    };
    const at = (a: number, b: number) =>
      enter.interpolate({ inputRange: [0, 1], outputRange: [a, b] });
    const cardW = at(o.width, end.w);
    const cardH = at(o.height, end.h);
    return {
      card: {
        position: 'absolute' as const,
        left: at(o.x, end.x),
        top: at(o.y, end.y),
        width: cardW,
        height: cardH,
        overflow: 'hidden' as const,
        borderRadius: closing
          ? at(o.radius, dragCorner)
          : Animated.add(at(o.radius, 0), dragRadius),
        // Closing: hands over to the circle's cover as it lands.
        opacity: closing
          ? enter.interpolate({
              inputRange: [0, 0.25, 1],
              outputRange: [0, 1, 1],
              extrapolate: 'clamp',
            })
          : 1,
        transform: dragMotion,
      },
      inner: {
        position: 'absolute' as const,
        width: W,
        height: H,
        left: Animated.multiply(Animated.subtract(cardW, W), 0.5),
        top: Animated.multiply(Animated.subtract(cardH, H), 0.5),
        transform: [{ scale: Animated.divide(cardW, W) }],
      },
    };
  }
  if (closing) {
    return {
      card: {
        ...full,
        overflow: 'hidden' as const,
        borderRadius: exit.interpolate({
          inputRange: [0, 0.25, 1],
          outputRange: [dragCorner / dragScale, 16 / 0.3, 16 / 0.12],
        }),
        opacity: exit.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1, 0] }),
        transform: [
          {
            translateY: exit.interpolate({
              inputRange: [0, 1],
              outputRange: [d, H * 0.92 - H / 2],
            }),
          },
          { scale: exit.interpolate({ inputRange: [0, 1], outputRange: [dragScale, 0.12] }) },
        ],
      },
      inner: null,
    };
  }
  return {
    card: {
      ...full,
      overflow: 'hidden' as const,
      borderRadius: dragRadius,
      transform: [
        { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [H, 0] }) },
        ...dragMotion,
      ],
    },
    inner: null,
  };
}

/** Bottom to top: loading stories, then loaded ones oldest first (the newest loaded on top). */
function drawOrder(layers: Layer[]): Layer[] {
  return [...layers].sort((a, b) => Number(a.ready) - Number(b.ready) || a.seq - b.seq);
}

interface MediaProps {
  layer: Layer;
  current: boolean;
  /**
   * Draw the black background of a story without gap colours. Off while it covers the previous
   * story. Gap colours are always drawn: they show at once and are the story's own.
   */
  background: boolean;
  paused: boolean;
  onReady(seq: number, durationMs?: number): void;
  onFailed(seq: number): void;
  onBuffering(on: boolean): void;
  onEnd(): void;
}

function Media({
  layer,
  current,
  background,
  paused,
  onReady,
  onFailed,
  onBuffering,
  onEnd,
}: MediaProps) {
  const { story, seq } = layer;
  const duration = useRef<number | undefined>(undefined);
  // Fill covers the screen; fit shows all of it, with the gaps in the story's colours.
  const look = storyLook(story);
  const gaps = (background || look.fill) && <GapFill fill={look.fill} />;
  if (layer.failed) {
    return (
      <View style={[StyleSheet.absoluteFill, s_.center]}>
        <Text style={s_.error}>This story couldn’t be loaded.</Text>
      </View>
    );
  }
  if (story.type === 'video') {
    if (!Video) {
      // Without react-native-video installed, video stories are skipped quickly.
      queueMicrotask(() => onFailed(seq));
      return null;
    }
    return (
      <>
        {gaps}
        <Video
          source={{ uri: story.url }}
          style={StyleSheet.absoluteFill}
          resizeMode={look.fit === 'fill' ? 'cover' : 'contain'}
          paused={paused || !current}
          muted={muted}
          repeat={false}
          playInBackground={false}
          ignoreSilentSwitch="obey"
          accessibilityLabel={story.alt || undefined}
          onLoad={(d: { duration?: number }) => {
            duration.current = d.duration ? d.duration * 1000 : undefined;
          }}
          onReadyForDisplay={() => onReady(seq, duration.current)}
          onBuffer={(b: { isBuffering: boolean }) => onBuffering(b.isBuffering)}
          onEnd={onEnd}
          onError={() => onFailed(seq)}
        />
        {/* A designed video's text and stickers, fitted as the story image would be. */}
        {look.overlay && (
          <Image
            source={{ uri: look.overlay }}
            style={StyleSheet.absoluteFill}
            resizeMode={look.fit === 'fill' ? 'cover' : 'contain'}
            fadeDuration={0}
            accessibilityIgnoresInvertColors
          />
        )}
      </>
    );
  }
  return (
    <>
      {gaps}
      <Image
        source={{ uri: story.url }}
        style={StyleSheet.absoluteFill}
        resizeMode={look.fit === 'fill' ? 'cover' : 'contain'}
        accessibilityLabel={story.alt || undefined}
        fadeDuration={0}
        onLoad={() => onReady(seq)}
        onError={() => onFailed(seq)}
      />
    </>
  );
}

/**
 * The gap colours around a story shown whole (black without colours): one gradient, top to
 * bottom. Stacked bands of colour left hairline seams where iOS rounded their fractional heights.
 */
function GapFill({ fill }: { fill: { top: string; bottom: string } | null }) {
  if (!fill) return <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]} />;
  const style = {
    // The middle colour where gradients aren't drawn.
    backgroundColor: mix(fill.top, fill.bottom, 0.5),
    experimental_backgroundImage: `linear-gradient(180deg, ${fill.top} 0%, ${fill.bottom} 100%)`,
  } as object;
  return <View style={[StyleSheet.absoluteFill, style]} pointerEvents="none" />;
}

/** "#rrggbb" between `a` (t = 0) and `b` (t = 1). */
function mix(a: string, b: string, t: number): string {
  const ch = (hex: string, i: number) => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const out = [0, 1, 2].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function IconButton({
  label,
  onPress,
  children,
}: {
  label: string;
  onPress(): void;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [s_.btn, pressed && { opacity: 0.6 }]}
    >
      {children}
    </Pressable>
  );
}

function useInsets() {
  const fromProvider = useContext(
    SafeAreaInsetsContext ?? (FallbackContext as NonNullable<typeof SafeAreaInsetsContext>),
  );
  if (fromProvider) return fromProvider;
  if (initialInsets) return initialInsets;
  return {
    top: Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 47,
    bottom: Platform.OS === 'ios' ? 34 : 0,
  };
}

const FallbackContext = createContext<{ top: number; bottom: number } | null>(null);

const s_ = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  hidden: { opacity: 0 },
  center: { alignItems: 'center', justifyContent: 'center' },
  error: { color: '#fff', fontSize: 15 },
  spinner: { position: 'absolute', alignSelf: 'center', top: '50%', marginTop: -18 },
  shade: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 140,
    experimental_backgroundImage: 'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, transparent 100%)',
  } as object,
  zone: { position: 'absolute', top: 110, bottom: 110 },
  top: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 8 },
  progress: { flexDirection: 'row', gap: 4 },
  seg: {
    flex: 1,
    height: 2.5,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.4)',
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: '#fff' },
  running: { width: '100%', transformOrigin: 'left' },
  // 16pt in from the edge (with top's 8), clear of the screen's rounded corners.
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingLeft: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#333' },
  name: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600' },
  btn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
});
