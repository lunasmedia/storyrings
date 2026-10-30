import type { Appearance } from '@stories/contracts/appearance';
import { badgeLabel } from '@stories/contracts/appearance';
import type { FeedGroupDto } from '@stories/core';
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import {
  type BarMetrics,
  gapColor,
  linearGradient,
  ringAnimation,
  ringPaint,
  SPEED_MS,
  titleColor,
} from './layout';
import { Video } from './optional';

export interface CircleProps {
  group: FeedGroupDto;
  appearance: Appearance;
  seen: boolean;
  metrics: BarMetrics;
  reducedMotion: boolean;
  /** Screen colour behind the bar (for the gap between ring and image). */
  background: string;
  /** App text colour (for "inherit" titles). */
  textColor: string;
  titleFont?: string;
  pressed?: boolean;
}

/** React Native's CSS gradient support (new architecture); ignored where unsupported. */
const gradient = (css: string | null): ViewStyle =>
  css ? ({ experimental_backgroundImage: css } as ViewStyle) : {};

/** One item of the story bar: ring (style, animation, seen colour), cover, badge and title. */
export const Circle = memo(function Circle({
  group,
  appearance,
  seen,
  metrics,
  reducedMotion,
  background,
  textColor,
  titleFont,
  pressed,
}: CircleProps) {
  const { ring, badge, title } = appearance;
  const paint = ringPaint(appearance, seen);
  const animation = ringAnimation(appearance, seen, reducedMotion);
  const { width, height, radius } = metrics;
  const gapRadius = Math.max(0, radius - paint.width);
  const imgRadius = Math.max(0, gapRadius - ring.gap);
  const label = badgeLabel(badge, group.endsAt);
  const cover = group.cover ?? { image: group.coverUrl, animated: false };

  return (
    <View style={[s.item, { width: width + 12 }]}>
      <View style={{ width, height, transform: [{ scale: pressed ? 0.95 : 1 }] }}>
        {animation === 'pulse' && (
          <Pulse
            color={paint.color}
            radius={radius}
            ring={paint.width}
            speed={SPEED_MS[ring.speed]}
          />
        )}
        <View
          style={[
            s.ring,
            {
              borderRadius: radius,
              padding: paint.width,
              backgroundColor: animation === 'rotate' ? 'transparent' : paint.color,
            },
            animation === 'rotate' ? null : gradient(paint.gradient),
          ]}
        >
          {/* Animated layers sit under the gap and image, so only the ring band shows them. */}
          {animation === 'rotate' && (
            <Spin colors={ring.colors} size={width + height} speed={SPEED_MS[ring.speed]} />
          )}
          {animation === 'shimmer' && <Shine width={width} speed={SPEED_MS[ring.speed]} />}
          <View
            style={[
              s.fill,
              {
                borderRadius: gapRadius,
                padding: ring.gap,
                backgroundColor: gapColor(appearance, background),
              },
            ]}
          >
            <View style={[s.fill, s.img, { borderRadius: imgRadius }]}>
              <Image source={{ uri: cover.image }} style={StyleSheet.absoluteFill} />
              {cover.animated && cover.video && !reducedMotion && Video && (
                <AnimatedCover uri={cover.video} />
              )}
            </View>
          </View>
        </View>
        {label && (
          <Text
            style={[
              s.badge,
              badge.position === 'top-right' ? s.topRight : s.bottom,
              {
                backgroundColor: badge.background,
                color: badge.color,
                borderColor: background,
                fontSize: Math.max(9, Math.min(width, height) * 0.15),
              },
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        )}
      </View>
      {!title.hidden && (
        <Text
          numberOfLines={title.maxLines}
          style={[
            s.title,
            {
              color: titleColor(appearance, textColor),
              fontWeight: String(title.weight) as '400',
              fontSize: metrics.titleSize,
              lineHeight: Math.round(metrics.titleSize * 1.25),
              fontFamily: titleFont,
            },
          ]}
        >
          {group.title}
        </Text>
      )}
    </View>
  );
});

function useLoop(make: (v: Animated.Value) => Animated.CompositeAnimation) {
  const value = useRef(new Animated.Value(0)).current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the loop is built once per mount
  useEffect(() => {
    const loop = Animated.loop(make(value));
    loop.start();
    return () => loop.stop();
  }, [value]);
  return value;
}

/** Rotating gradient behind the ring band. */
function Spin({ colors, size, speed }: { colors: string[]; size: number; speed: number }) {
  const v = useLoop((value) =>
    Animated.timing(value, {
      toValue: 1,
      duration: speed,
      easing: Easing.linear,
      useNativeDriver: true,
    }),
  );
  const rotate = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          left: '50%',
          top: '50%',
          marginLeft: -size / 2,
          marginTop: -size / 2,
          backgroundColor: colors[0],
          transform: [{ rotate }],
        },
        gradient(linearGradient(90, [...colors, colors[0]!])),
      ]}
    />
  );
}

/** Soft glowing outline that grows out of the ring and fades. */
function Pulse({
  color,
  radius,
  ring,
  speed,
}: {
  color: string;
  radius: number;
  ring: number;
  speed: number;
}) {
  const v = useLoop((value) =>
    Animated.timing(value, {
      toValue: 1,
      duration: speed,
      easing: Easing.bezier(0.2, 0.6, 0.35, 1),
      useNativeDriver: true,
    }),
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        // An outline just outside the ring, blurred by a shadow, like the web SDK's glow.
        position: 'absolute',
        top: -ring,
        left: -ring,
        right: -ring,
        bottom: -ring,
        borderRadius: radius + ring,
        borderWidth: ring,
        borderColor: color,
        boxShadow: `0 0 ${ring * 3}px ${color}`,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.75, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] }) }],
      }}
    />
  );
}

/** Light sweep across the ring. */
function Shine({ width, speed }: { width: number; speed: number }) {
  const band = width * 0.55;
  const v = useLoop((value) =>
    Animated.sequence([
      Animated.timing(value, {
        toValue: 1,
        duration: speed * 0.6,
        easing: Easing.bezier(0.45, 0.05, 0.55, 0.95),
        useNativeDriver: true,
      }),
      Animated.delay(speed * 0.4),
    ]),
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          top: 0,
          bottom: 0,
          left: 0,
          width: band,
          transform: [
            {
              translateX: v.interpolate({ inputRange: [0, 1], outputRange: [-1.1 * band, width] }),
            },
          ],
        },
        gradient(linearGradient(100, ['transparent', 'rgba(255,255,255,0.85)', 'transparent'])),
      ]}
    />
  );
}

/** Looping muted video for GIF covers; the still cover shows until it plays. */
function AnimatedCover({ uri }: { uri: string }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!Video || failed) return null;
  // The video is only a picture: it must never take the tap meant for the circle
  // (on Android the player view would otherwise swallow it).
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Video
        source={{ uri }}
        muted
        repeat
        paused={false}
        resizeMode="cover"
        controls={false}
        disableFocus
        playInBackground={false}
        onReadyForDisplay={() => setPlaying(true)}
        onError={() => setFailed(true)}
        style={[StyleSheet.absoluteFill, { opacity: playing ? 1 : 0 }]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  item: { alignItems: 'center', paddingTop: 4, gap: 8 },
  ring: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
  img: { overflow: 'hidden', backgroundColor: '#ddd' },
  badge: {
    position: 'absolute',
    zIndex: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 2,
    overflow: 'hidden',
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  bottom: { alignSelf: 'center', bottom: -8 },
  topRight: { right: -6, top: -6 },
  title: { textAlign: 'center', maxWidth: '100%' },
});
