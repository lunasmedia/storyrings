import {
  ENERGIZED_PREVIEW_MS,
  EnergizedCycle,
  type EnergizedPreview,
  type FeedGroupDto,
  type FeedStoryDto,
} from '@stories/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Circle, type CircleProps } from './Circle';
import { TEXTURE_VIEW, Video } from './optional';

/** Wait for scrolling to settle before starting again from the first visible card. */
const SETTLE_MS = 150;

/**
 * The Energized style: previews stories inside vertical cards, one group at a time
 * (EnergizedCycle decides which; the bar scrolls each card into view for its turn). `visibleNow`
 * gives the cards entirely on screen; call `onScroll` as the bar scrolls. Plays only while `active` (the viewer isn't open) and
 * the app is in the foreground. Previews send no analytics and mark nothing seen.
 */
export function useEnergized({
  enabled,
  active,
  groups,
  visibleNow,
}: {
  enabled: boolean;
  active: boolean;
  groups: readonly FeedGroupDto[];
  visibleNow(): number[];
}) {
  const [preview, setPreview] = useState<EnergizedPreview | null>(null);
  const cycle = useRef<EnergizedCycle | null>(null);
  const t = useRef<{
    settle?: ReturnType<typeof setTimeout>;
    next?: ReturnType<typeof setTimeout>;
    last: number;
  }>({ last: 0 });
  const running = useRef(false);
  const appActive = useRef(AppState.currentState === 'active');
  const visible = useRef(visibleNow);
  visible.current = visibleNow;

  /** Moves the cycle on by the time played since the last tick. */
  const tick = useCallback(() => {
    const now = Date.now();
    if (t.current.last && running.current) cycle.current?.tick(now - t.current.last);
    t.current.last = running.current ? now : 0;
  }, []);

  const update = useCallback(() => {
    tick();
    clearTimeout(t.current.next);
    const current = running.current ? (cycle.current?.current() ?? null) : null;
    setPreview((prev) => (prev?.turn === current?.turn ? prev : current));
    if (current && cycle.current) t.current.next = setTimeout(update, cycle.current.remainingMs());
  }, [tick]);

  const setRunning = useCallback(() => {
    tick();
    running.current = active && appActive.current && !!cycle.current;
    update();
  }, [active, tick, update]);

  // A new cycle only for a new feed (or the style turning on). Opening and closing the viewer
  // only pauses and resumes it (below), so the previews carry on where they were.
  const latestSetRunning = useRef(setRunning);
  latestSetRunning.current = setRunning;
  useEffect(() => {
    cycle.current = enabled ? new EnergizedCycle(groups) : null;
    cycle.current?.setVisible(visible.current());
    t.current.last = 0;
    latestSetRunning.current();
  }, [enabled, groups]);

  useEffect(() => {
    setRunning();
  }, [setRunning]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      appActive.current = state === 'active';
      setRunning();
    });
    return () => sub.remove();
  }, [setRunning]);

  useEffect(() => {
    const timers = t.current;
    return () => {
      clearTimeout(timers.settle);
      clearTimeout(timers.next);
    };
  }, []);

  const onScroll = useCallback(() => {
    if (!cycle.current) return;
    clearTimeout(t.current.settle);
    t.current.settle = setTimeout(() => {
      tick();
      cycle.current?.setVisible(visible.current());
      update();
    }, SETTLE_MS);
  }, [tick, update]);

  return { preview, onScroll };
}

/**
 * A story over a card's cover: a muted video, or an image zooming in and out. Fades in once it
 * can show, so the cover stays until then (or if it can't load).
 */
export function StoryPreview({
  story,
  onShown,
}: {
  story: FeedStoryDto;
  /** It's showing (true once it can). */
  onShown?: () => void;
}) {
  const shown = useRef(new Animated.Value(0)).current;
  const zoom = useRef(new Animated.Value(0)).current;
  const [failed, setFailed] = useState(false);
  const show = () => {
    Animated.timing(shown, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    onShown?.();
  };
  useEffect(() => {
    if (story.type !== 'image') return;
    const run = Animated.timing(zoom, {
      toValue: 1,
      duration: ENERGIZED_PREVIEW_MS,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    });
    run.start();
    return () => run.stop();
  }, [story.type, zoom]);
  if (failed || (story.type === 'video' && !Video)) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: shown }]}>
      {story.type === 'video' && Video ? (
        <Video
          // Android: a TextureView, which moves and fades with the views around it (a SurfaceView
          // showed black while the viewer slid in, and lagged behind animations and scrolling).
          viewType={TEXTURE_VIEW}
          source={{ uri: story.url }}
          muted
          paused={false}
          repeat={false}
          resizeMode="cover"
          controls={false}
          disableFocus
          playInBackground={false}
          onReadyForDisplay={show}
          onError={() => setFailed(true)}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={StyleSheet.absoluteFill}>
          <Animated.Image
            source={{ uri: story.url }}
            resizeMode="cover"
            onLoad={show}
            onError={() => setFailed(true)}
            style={[
              StyleSheet.absoluteFill,
              {
                transform: [
                  {
                    scale: zoom.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [1, 1.1, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        </View>
      )}
    </Animated.View>
  );
}

/** Energized cards: the circle in the middle is this share of the card's width. */
export const ENERGIZED_AVATAR = 0.5;

/**
 * An Energized card's still: its first story (the one it previews) as an image, or a video's
 * first frame (a paused player; needs react-native-video). Fades in once it can show; if it
 * can't, `onFailed` (the card shows the cover instead).
 */
export function CardStill({
  story,
  onFailed,
}: {
  story: FeedStoryDto | undefined;
  onFailed?: () => void;
}) {
  const shown = useRef(new Animated.Value(0)).current;
  const [failed, setFailedState] = useState(false);
  const setFailed = (value: boolean) => {
    setFailedState(value);
    if (value) onFailed?.();
  };
  const show = () =>
    Animated.timing(shown, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  if (!story || failed || (story.type === 'video' && !Video && !story.poster)) return null;
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: shown }]}>
      {/* Videos: their poster from the server when there is one, a paused player otherwise
        (one video player per card was a lot for Android phones to run alongside the previews). */}
      {story.type === 'video' && !story.poster && Video ? (
        <Video
          // Android: a TextureView, which moves and fades with the views around it (a SurfaceView
          // showed black while the viewer slid in, and lagged behind animations and scrolling).
          viewType={TEXTURE_VIEW}
          source={{ uri: story.url }}
          muted
          paused
          repeat={false}
          resizeMode="cover"
          controls={false}
          disableFocus
          playInBackground={false}
          onReadyForDisplay={show}
          onError={() => setFailed(true)}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <Image
          source={{ uri: story.type === 'video' ? story.poster : story.url }}
          resizeMode="cover"
          fadeDuration={0}
          onLoad={show}
          onError={() => setFailed(true)}
          style={StyleSheet.absoluteFill}
        />
      )}
    </Animated.View>
  );
}

/**
 * An Energized style card: a story-shaped card showing a still of the group's first story (which
 * plays on its turn; the cover until the still loads), the group's circle in the middle (ring,
 * animation, seen colour and badge as usual; hidden while the story shows) and the title inside
 * the card at the bottom.
 */
export function EnergizedCard({
  preview,
  previewTurn,
  held = false,
  ...circle
}: CircleProps & {
  /** The story previewing in this card now, if any. */
  preview?: FeedStoryDto | null;
  /**
   * Its viewer is open, opened while this card previewed: the circle stays aside until the
   * preview shows again (or moves on to another card).
   */
  held?: boolean;
  /** Changes each time a preview starts, so the same story starts again. */
  previewTurn?: number;
}) {
  const { group, appearance, metrics, pressed } = circle;
  const { width, height, radius } = metrics;
  const avatar = Math.round(width * ENERGIZED_AVATAR);
  const cover = group.cover ?? { image: group.coverUrl, animated: false };
  // The circle gives way to the story while it shows, and while the viewer opened from that
  // preview is open (until the preview shows again); it comes back when the turn is over. Read
  // from the props in the same render, so it never starts coming back as the viewer opens.
  const [shownTurn, setShownTurn] = useState<number | undefined>();
  const [keepAside, setKeepAside] = useState(false);
  useEffect(() => {
    if (held) setKeepAside(true);
    else if (!preview) setKeepAside(false);
  }, [held, preview]);
  const hideCircle = (!!preview && shownTurn === previewTurn) || held || keepAside;
  // The cover fills the card only if there's no still to show: shown while the still loads, it
  // would flash up and then change.
  const first = group.stories[0];
  const [stillFailed, setStillFailed] = useState(false);
  const showCover = !first || stillFailed || (first.type === 'video' && !Video);
  const circleOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(circleOpacity, {
      toValue: hideCircle ? 0 : 1,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [hideCircle, circleOpacity]);
  return (
    <View style={{ width: width + 12, paddingTop: 4, alignItems: 'center' }}>
      <View
        style={{
          width,
          height,
          borderRadius: radius,
          overflow: 'hidden',
          backgroundColor: '#222',
          transform: [{ scale: pressed ? 0.97 : 1 }],
        }}
      >
        {showCover ? (
          <Image source={{ uri: cover.image }} style={StyleSheet.absoluteFill} />
        ) : (
          <CardStill key={first.url} story={first} onFailed={() => setStillFailed(true)} />
        )}
        {preview && (
          <StoryPreview
            key={previewTurn}
            story={preview}
            onShown={() => {
              setShownTurn(previewTurn);
              setKeepAside(false);
            }}
          />
        )}
        <View
          pointerEvents="none"
          style={[
            card.scrim,
            {
              experimental_backgroundImage:
                'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.6) 100%)',
            } as object,
          ]}
        />
        <Animated.View pointerEvents="none" style={[card.middle, { opacity: circleOpacity }]}>
          <Circle
            {...circle}
            appearance={{ ...appearance, title: { ...appearance.title, hidden: true } }}
            metrics={{ ...metrics, width: avatar, height: avatar, radius: avatar / 2 }}
            pressed={false}
          />
        </Animated.View>
        {!appearance.title.hidden && (
          <Text
            numberOfLines={appearance.title.maxLines}
            style={[
              card.title,
              {
                fontWeight: String(appearance.title.weight) as '400',
                fontSize: metrics.titleSize,
                lineHeight: Math.round(metrics.titleSize * 1.25),
                fontFamily: circle.titleFont,
              },
            ]}
          >
            {group.title}
          </Text>
        )}
      </View>
    </View>
  );
}

const card = StyleSheet.create({
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '45%' },
  middle: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 8,
    textAlign: 'center',
    color: '#ffffff',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
