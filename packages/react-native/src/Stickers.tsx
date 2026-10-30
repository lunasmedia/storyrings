import {
  type AnswerResultsDto,
  type AnswerStore,
  CORRECT_COLOR,
  countdownParts,
  type FeedInteractionDto,
  type FeedStoryDto,
  INTERACTION_UNITS,
  interactionLabels,
  percentages,
  placeInteraction,
  type StoredAnswer,
  storyLook,
  WRONG_COLOR,
} from '@stories/core';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  type GestureResponderEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Poll = Extract<FeedInteractionDto, { kind: 'poll' | 'quiz' }>;
type Slider = Extract<FeedInteractionDto, { kind: 'slider' }>;
type Countdown = Extract<FeedInteractionDto, { kind: 'countdown' }>;
export type LinkSticker = Extract<FeedInteractionDto, { kind: 'link' }>;

export interface StickersProps {
  story: FeedStoryDto;
  /** The viewer's size: the image fits into it as the story says (fill or fit). */
  width: number;
  height: number;
  answers: AnswerStore | null;
  send(storyId: string, interactionId: string, value: number): Promise<AnswerResultsDto | null>;
  onLink(sticker: LinkSticker): void;
  /** Dragging the emoji slider holds the story. */
  hold(on: boolean): void;
}

/**
 * Interactive stickers (polls, quizzes, emoji sliders, links, countdowns) drawn over a story's
 * image, at the place the studio put them (spec/README.md, "Interactions").
 */
export function Stickers({ story, width, height, answers, send, onLink, hold }: StickersProps) {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const current = useRef(story.id);
  current.current = story.id;
  if (!width || !height || !story.interactions?.length) return null;
  const media = story.width && story.height ? { width: story.width, height: story.height } : null;

  const answer = (i: FeedInteractionDto, value: number) => {
    answers?.set(story.id, i.id, { value });
    redraw();
    void send(story.id, i.id, value).then((results) => {
      if (!results) return;
      answers?.set(story.id, i.id, { value, results });
      if (current.current === story.id) redraw();
    });
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {story.interactions.map((i) => {
        const p = placeInteraction(
          { width, height },
          media,
          storyLook(story).fit === 'fill' ? 'cover' : 'contain',
          i,
        );
        const u = p.width / INTERACTION_UNITS;
        const saved = answers?.get(story.id, i.id);
        const box = {
          position: 'absolute' as const,
          left: p.x - p.width / 2,
          top: p.y,
          width: p.width,
        };
        if (i.kind === 'link') {
          return (
            <Centered key={i.id} style={box}>
              <Pressable
                accessibilityRole="link"
                onPress={() => onLink(i)}
                style={({ pressed }) => [
                  s.pill,
                  { height: 84 * u, borderRadius: 42 * u, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={{ color: i.accent, fontSize: 30 * u, fontWeight: '700' }}
                >
                  {i.label} ↗
                </Text>
              </Pressable>
            </Centered>
          );
        }
        const title = i.kind === 'countdown' ? i.title : i.question;
        return (
          <Centered key={i.id} style={box}>
            {/* The card takes touches that miss its controls, so they never skip the story. */}
            <View
              onStartShouldSetResponder={() => true}
              onResponderTerminationRequest={() => false}
              style={[s.card, { padding: 28 * u, borderRadius: 28 * u }]}
            >
              {!!title && (
                <Text
                  numberOfLines={3}
                  style={[
                    s.q,
                    { fontSize: 32 * u, marginBottom: 20 * u },
                    i.kind === 'countdown' && {
                      color: i.accent,
                      fontSize: 28 * u,
                      fontWeight: '600',
                    },
                  ]}
                >
                  {title}
                </Text>
              )}
              {i.kind === 'poll' || i.kind === 'quiz' ? (
                <Options sticker={i} u={u} saved={saved} onAnswer={(v) => answer(i, v)} />
              ) : i.kind === 'slider' ? (
                <SliderTrack
                  sticker={i}
                  u={u}
                  saved={saved}
                  hold={hold}
                  onAnswer={(v) => answer(i, v)}
                />
              ) : (
                <CountdownRow sticker={i} u={u} />
              )}
            </View>
          </Centered>
        );
      })}
    </View>
  );
}

/** Centres its child on the box's top edge (the sticker's centre point), whatever its height. */
function Centered({ style, children }: { style: object; children: React.ReactNode }) {
  const [h, setH] = useState(0);
  return (
    <View
      style={[style, { transform: [{ translateY: -h / 2 }], opacity: h ? 1 : 0 }]}
      pointerEvents="box-none"
      onLayout={(e) => setH(e.nativeEvent.layout.height)}
    >
      {children}
    </View>
  );
}

function Options({
  sticker: i,
  u,
  saved,
  onAnswer,
}: {
  sticker: Poll;
  u: number;
  saved?: StoredAnswer;
  onAnswer(value: number): void;
}) {
  const counts = saved?.results?.counts;
  const pct = counts ? percentages(counts) : null;
  return (
    <View
      style={{ gap: 12 * u }}
      accessibilityRole="radiogroup"
      accessibilityLabel={i.question || undefined}
    >
      {i.options.map((label, n) => {
        const chosen = saved?.value === n;
        const right = !!saved && i.kind === 'quiz' && i.correct === n;
        const wrong = !!saved && i.kind === 'quiz' && chosen && !right;
        const share = right || wrong ? 100 : pct ? pct[n]! : chosen ? 100 : 0;
        const mark = !saved ? '' : wrong ? '✕ ' : chosen || right ? '✓ ' : '';
        return (
          <Pressable
            // biome-ignore lint/suspicious/noArrayIndexKey: options have no identity of their own
            key={n}
            disabled={!!saved}
            onPress={() => onAnswer(n)}
            accessibilityRole="radio"
            accessibilityState={{ checked: chosen, disabled: !!saved }}
            accessibilityLabel={pct ? interactionLabels.pollOption(label, pct[n]!) : label}
            style={[s.opt, { height: 76 * u, borderRadius: 38 * u, paddingHorizontal: 24 * u }]}
          >
            {saved && (
              <View
                style={[
                  StyleSheet.absoluteFill,
                  {
                    width: `${share}%`,
                    backgroundColor: right ? CORRECT_COLOR : wrong ? WRONG_COLOR : i.accent,
                    opacity: right || wrong ? 0.35 : chosen ? 0.5 : 0.3,
                  },
                ]}
              />
            )}
            <Text
              numberOfLines={1}
              style={[s.optText, { fontSize: 28 * u, textAlign: saved ? 'left' : 'center' }]}
            >
              {mark}
              {label}
            </Text>
            {pct && (
              <Text style={[s.optText, { fontSize: 24 * u, marginLeft: 12 * u, flex: 0 }]}>
                {pct[n]}%
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function SliderTrack({
  sticker: i,
  u,
  saved,
  hold,
  onAnswer,
}: {
  sticker: Slider;
  u: number;
  saved?: StoredAnswer;
  hold(on: boolean): void;
  onAnswer(value: number): void;
}) {
  const [value, setValue] = useState(saved?.value ?? 0);
  const width = useRef(0);
  const latest = useRef({ value, saved, onAnswer, hold });
  latest.current = { value, saved, onAnswer, hold };
  // Page position of the track's left edge, found when the finger goes down (locationX can be
  // relative to another view once the finger moves).
  const left = useRef(0);
  const unit = useRef(u);
  unit.current = u;
  const responder = useMemo(() => {
    const fromX = (e: GestureResponderEvent) => {
      const k = unit.current;
      const v = ((e.nativeEvent.pageX - left.current - 36 * k) / (width.current - 72 * k)) * 100;
      const next = Math.round(Math.max(0, Math.min(100, v)));
      latest.current.value = next;
      setValue(next);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !latest.current.saved,
      onMoveShouldSetPanResponder: () => !latest.current.saved,
      // The viewer's swipe gestures can't take the drag over.
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        left.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        latest.current.hold(true);
        fromX(e);
      },
      onPanResponderMove: (e) => fromX(e),
      onPanResponderRelease: () => {
        latest.current.hold(false);
        latest.current.onAnswer(latest.current.value);
      },
      onPanResponderTerminate: () => latest.current.hold(false),
    });
  }, []);
  const at = (v: number) => 36 * u + (width.current - 72 * u) * (v / 100);
  const avg = saved?.results?.average;
  return (
    <View
      style={{ height: 72 * u, justifyContent: 'center' }}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
        setValue((v) => v);
      }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={interactionLabels.slider(i.question)}
      accessibilityValue={{ min: 0, max: 100, now: value }}
      accessibilityActions={
        saved ? [] : [{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]
      }
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'activate') onAnswer(value);
        else
          setValue((v) =>
            Math.max(0, Math.min(100, v + (e.nativeEvent.actionName === 'increment' ? 10 : -10))),
          );
      }}
      {...responder.panHandlers}
    >
      <View pointerEvents="none" style={[s.rail, { height: 14 * u, borderRadius: 7 * u }]} />
      <View
        pointerEvents="none"
        style={[
          s.rail,
          {
            height: 14 * u,
            borderRadius: 7 * u,
            backgroundColor: i.accent,
            right: undefined,
            width: at(value),
          },
        ]}
      />
      {avg !== undefined && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: at(avg) - 14 * u,
            width: 28 * u,
            height: 28 * u,
            borderRadius: 14 * u,
            backgroundColor: i.accent,
            borderWidth: 4 * u,
            borderColor: '#fff',
          }}
        />
      )}
      <Text
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: at(value) - 36 * u,
          width: 72 * u,
          textAlign: 'center',
          fontSize: 64 * u * 0.85,
        }}
      >
        {i.emoji}
      </Text>
    </View>
  );
}

function CountdownRow({ sticker: i, u }: { sticker: Countdown; u: number }) {
  const [now, setNow] = useState(Date.now());
  const c = countdownParts(i.endsAt, now);
  useEffect(() => {
    if (c.ended) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [c.ended]);
  if (c.ended) {
    return (
      <Text style={[s.q, { fontSize: 40 * u, marginBottom: 0 }]}>
        {interactionLabels.countdownEnded}
      </Text>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 12 * u }} accessibilityRole="timer">
      {[c.days, c.hours, c.minutes, c.seconds].map((n, k) => (
        <View key={interactionLabels.countdownUnits[k]} style={{ flex: 1, alignItems: 'center' }}>
          <Text
            style={{
              fontSize: 56 * u,
              fontWeight: '700',
              color: '#111',
              fontVariant: ['tabular-nums'],
            }}
          >
            {String(n).padStart(2, '0')}
          </Text>
          <Text style={{ fontSize: 18 * u, color: '#868e96', marginTop: 4 * u }}>
            {interactionLabels.countdownUnits[k]}
          </Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  q: { color: '#111', fontWeight: '700', textAlign: 'center', lineHeight: undefined },
  opt: {
    backgroundColor: '#f1f3f5',
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
  },
  optText: { flex: 1, color: '#111', fontWeight: '600' },
  rail: { position: 'absolute', left: 0, right: 0, backgroundColor: '#e9ecef' },
  pill: {
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
});
