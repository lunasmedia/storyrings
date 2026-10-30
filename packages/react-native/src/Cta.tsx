import { type CtaStyle, isSwipeCta } from '@stories/core';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, Text, View } from 'react-native';

/**
 * The story button, in its style (spec: Story button): a white or dark pill, an outline, or a
 * swipe up (a chevron over the label, or over a white pill).
 */
export function CtaButton({
  label,
  style,
  bottom,
  onPress,
}: {
  label: string;
  style: CtaStyle;
  /** Space below it: the home indicator plus a margin. */
  bottom: number;
  onPress(): void;
}) {
  const swipe = isSwipeCta(style);
  const bare = style === 'swipe';
  return (
    <View style={[s.wrap, { paddingBottom: bottom }]} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        accessibilityLabel={label}
        style={({ pressed }) => [s.press, pressed && { opacity: 0.85 }]}
      >
        {swipe && <Chevron />}
        <View
          style={[
            s.cta,
            style === 'dark' && s.dark,
            style === 'outline' && s.outline,
            bare && s.bare,
          ]}
        >
          <Text
            style={[s.text, style === 'dark' && s.white, (style === 'outline' || bare) && s.light]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

/** An upward chevron that bobs gently, unless the person asked for reduced motion. */
function Chevron() {
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (!active || reduced) return;
      const half = { duration: 700, useNativeDriver: true };
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(lift, { ...half, toValue: -6 }),
          Animated.timing(lift, { ...half, toValue: 0 }),
        ]),
      );
      loop.start();
    });
    return () => {
      active = false;
      loop?.stop();
    };
  }, [lift]);
  return (
    <Animated.View
      style={[s.chevron, { transform: [{ translateY: lift }, { rotate: '45deg' }] }]}
    />
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  press: { alignItems: 'center', maxWidth: '80%' },
  cta: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  dark: { backgroundColor: '#111' },
  outline: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#fff',
    paddingVertical: 10,
  },
  bare: { backgroundColor: 'transparent', paddingTop: 4, paddingBottom: 10 },
  text: { color: '#000', fontSize: 15, fontWeight: '600' },
  white: { color: '#fff' },
  light: {
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  chevron: {
    width: 14,
    height: 14,
    marginTop: 8,
    marginBottom: 4,
    borderColor: '#fff',
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderRadius: 2,
  },
});
