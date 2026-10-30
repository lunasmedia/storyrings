# Stories SDK behaviour spec

The rules every Stories SDK must follow, written as language-neutral test cases. An SDK
(Web, React Native, Flutter, iOS, Android) is correct when it passes every case here; how it
does that is up to it. This is how SDKs in different languages stay identical, including the
analytics that billing depends on.

The TypeScript SDKs run these cases in `packages/core/test/conformance.test.ts`.

## Layout

| File | What it covers |
|---|---|
| `constants.json` | Values used as-is: viewability times, tap length, session timeout, viewer ID lifetime, analytics batching, seen-store size, tag rules, storage keys, accessibility labels |
| `cases/viewer.json` | The story viewer: navigation, timing, pausing, viewability, and the analytics events each step produces |
| `cases/feed.json` | Parsing a `/v1/feed` response defensively |
| `cases/tags.json` | Normalising user tags; story group tag filters |
| `cases/links.json` | Share links (web and app) and which button links may open |
| `cases/gestures.json` | Turning touches into taps, holds and swipes |
| `cases/seen.json` | Which stories count as seen; where the viewer starts |
| `cases/analytics.json` | The analytics batch format, batching, retries and dropping |
| `cases/sessions.json` | App sessions (active users) and the anonymous viewer ID's lifetime |
| `cases/display.json` | How a story fits the screen (fill, or fit with coloured gaps) |
| `cases/interactions.json` | Interactive stickers: reading them, placing them on the image, poll percentages, countdowns |

## Case format

```json
{
  "suite": "links",
  "description": "What the suite covers",
  "cases": [
    { "name": "app: filling in the share link",
      "input":  { "op": "appShareUrl", "template": "https://…/{group}/{story}", "target": { "groupId": "g 1", "storyId": "s/2" } },
      "expect": { "url": "https://…/g%201/s%2F2" } }
  ]
}
```

Each SDK's test runner reads every file in `cases/`, maps each case's `input` to a result
with its own code, and compares the result with `expect` as JSON (key order doesn't matter;
missing optional keys are left out, not `null`).

## What each suite's input and result are

**viewer.** Input: `groups` (`id`, `stories` with `id`, `durationMs`, optional
`type: "image" | "video"`), `open` (group index), optional `startStoryIndex`
(`{ "<groupIndex>": storyIndex }`: where entering that group starts, e.g. the first unseen
story), and `steps` (actions, below). Result: `opened` (the state after opening), `events`
(from opening), and for each step: `action`, `state`, `events`, `progress` (each progress
bar's fill, 0–1).

- Actions: `NEXT` (`auto: true` when a story ended by itself), `PREV`, `NEXT_GROUP`,
  `PREV_GROUP`, `TICK` (`ms` of time passing), `PAUSE`, `RESUME`, `MEDIA_LOADING`,
  `MEDIA_READY` (`durationMs?`, `failed?`), `HIDE`, `SHOW`, `CLOSE`.
- State: `at` (current story id, or `"closed"`), `open`, `groupIndex`, `storyIndex`,
  `elapsedMs`, `durationMs`, `paused`, `buffering`, `displayed`, `hidden`, `viewableMs`,
  `viewed`, `closeReason` (`"user" | "completed" | null`), `seq` (goes up each time a story
  starts; reload media when it changes).
- Events per step: events from the action first (`tap_forward`, `tap_back`, `group_skip`,
  `exit`), then events from the change of state (`group_complete`, `group_open`,
  `story_view`).

**feed.** Input: `body` (a `/v1/feed` response). Result: `{ "feed": … }` (the normalised
feed) or `{ "error": code }`.

**tags.** Input `{ "op": "normalize", "tags" }` → `{ "tags" }`; or
`{ "op": "filter", "conditions", "tags" }` → `{ "matches" }`.

**links.** `op` is one of `shareUrl` (`pageUrl`, `target`) → `{ "url" }`;
`parseShareLink` (`url`) → `{ "target" }` (or `null`); `withoutShareLink` (`url`) →
`{ "url" }`; `appShareUrl` (`template`, `target`) → `{ "url" }`; `ctaAllowed` (`url`,
`schemes?`) → `{ "allowed" }`; `ctaStyle` (`style?`: a story button's `style`) →
`{ "style", "swipe" }`.

**gestures.** Input: `width`, `events` (`["down", x, y, t]`, `["move", x, y]`,
`["up", x, y, t]`, `["cancel"]`). Result: `calls` in order: `["press"]`, `["release"]`,
`["tap", x]` (x as a fraction of the width, rounded to 3 decimals), `["swipe", direction]`,
`["drag", dx, dy]`.

**seen.** Input: `ops` (`["markSeen", id]`, `["markMany", prefix, count]` (marks
`prefix0` … `prefix<count-1>`), `["has", id]`, `["isGroupSeen", storyIds]`,
`["firstUnseenIndex", storyIds]`). Result: `results`, one per op (`null` for ops that
return nothing).

**analytics.** Input: `options` (`sdk`, `sessionId`, optional `maxBatch`, `maxQueue`,
`platform`, `viewer`, `automation`) and `steps`: `{ "track": event, "at": ms }` (the clock
reads `at`), or `{ "flush": { "beacon"?: true, "fail"?: n } }` (the next `n` sends fail;
`beacon` = the app is going away). A batch only goes out when it's full or on a flush;
sending on a timer (every `flushIntervalMs`) isn't part of the cases. Result: per step, the
batches `sent` (`body` parsed from JSON, and `beacon`) and how many events are `pending`.

**sessions.** Input `{ "op": "newSession", "leftAt", "now" }` → `{ "newSession" }`; or
`{ "op": "viewerId", "stored"?, "now" }` (what's in storage under the viewer key: an object,
unreadable text, or nothing) → `{ "kept" }` (the stored ID is still used) and `{ "stored" }`
(an ID is in storage afterwards).

**interactions.** `op` is one of `parse` (`interactions`: a story's raw `interactions`
value) → `{ "interactions" }`; `place` (`container` `[w, h]`, `media` `[w, h]` or `null`,
`fit` `"cover" | "contain"`, `x`, `y`, `width`) → `{ x, y, width, scale }` (rounded to 3
decimals); `percentages` (`counts`) → `{ "percents" }`; `countdown` (`endsAt`, `now`, ISO
times) → `{ ended, days, hours, minutes, seconds }`.

**display.** Input `{ "story" }` (a feed story) → `{ fit, fill, overlay }` (`overlay` is the address of the video's overlay image, or `null`).

## Fitting the screen

Phones are taller or wider than a story, so each story says how to fit the screen (`fit`):

- `"fill"` covers it: the image is scaled to cover the viewer, cropping what's beyond the edges
  (the sides on tall phones). Keep key content away from the edges.
- `"fit"` shows all of it: the image is scaled to fit inside the viewer, and the gaps (above
  and below on tall phones, at the sides on wider screens) show a vertical gradient from
  `fill.top` to `fill.bottom`, colours taken from the image's edges so the gaps blend in.

Anything other than `"fill"`, including no value (older servers), is `"fit"`. `fill` is kept
only for `"fit"` and only when both colours are `#rrggbb`; otherwise the gaps are black. Videos
fit the same way. Interactive stickers are placed with the story's fit (below).

The viewer is the whole screen, including under the status bar and the home indicator or
navigation bar, as the studio previews stories on full phone screens. Only the header, the
story button and other controls keep clear of those areas.

### Overlays on videos

A video designed in the studio (text, shapes or emoji over it) carries `overlay`: a transparent
1080 × 1920 image of them. It's drawn over the video and under the interactive stickers and the
controls, fitted to the viewer as a 1080 × 1920 story image would be with the story's `fit`
(covering it for `"fill"`, shown whole for `"fit"`). Only videos have overlays (a designed photo
has its text in the image), and only `http(s)` addresses are used; anything else is ignored.

## Story button

A story's `cta` (`label`, `url`) is drawn centred at the bottom, clear of the home indicator, and
opens its link when tapped (`cta_click`, through the host's handler first, then only allowed
links). Its `style` says how it looks; anything unknown, or none (older servers), is `"pill"`:

- `"pill"`: a white pill (#fff, fully rounded), the label in #111 at 15 pt semibold, padding
  12 × 22.
- `"dark"`: the same pill in #111 with a white label.
- `"outline"`: no fill, a 2 pt white border, a white label with a soft shadow.
- `"swipe"`: an upward white chevron over the white label (with a soft shadow), no pill.
- `"swipe-pill"`: the chevron over a white pill.

The chevron may bob gently (6 pt, about 1.4 s a cycle), except with reduced motion. With
`"swipe"` or `"swipe-pill"` a swipe up anywhere on the story does what tapping the button does;
with other styles a swipe up does nothing.

## Interactions

Stories designed in the studio can carry interactive stickers (`interactions` on a feed
story): polls, quizzes, emoji sliders, link stickers and countdowns. They are not in the
story's image; the SDK draws them over it.

**Reading.** Drop a sticker without a string `id`, with an unknown `kind`, or without numeric
`x`, `y` and a positive `width`. `accent` defaults to `#c2255c` unless it is `#rrggbb`.
Polls and quizzes keep their string `options` (the first four) and need at least two; a
quiz's `correct` must be the index of one of them. Missing questions and titles are `""`,
a missing slider emoji is 😍. Links need a non-empty `label` and a string `url`; countdowns
an `endsAt` that parses as a time.

**Placing.** `x`, `y` (the centre) and `width` are in the 1080 × 1920 design space of the
story image. Fit the image into the viewer as the story says (`cover` for `"fill"`, `contain`
for `"fit"`), then map the design space onto that rectangle. Interactive stickers are never rotated.

**Drawing.** Sizes are in units u = displayed width / 600. Cards (poll, quiz, slider,
countdown) are white, corner radius 28u, padding 28u, with the question or title at 32u bold
(#111, centred, up to three lines) and 20u below it.

- Poll and quiz: options 76u tall, radius 38u, #f1f3f5, label 28u semibold, 12u apart.
  After answering: each option fills from the left by its percentage (accent at 30%
  opacity; the chosen one at 50%) and shows the percentage at the right; the chosen one has
  a ✓. Quiz: instead, the right option fills completely with #2f9e44 (35% opacity) and has a
  ✓, and a wrong choice fills completely with #e03131 (35%) and has a ✕; others as a poll.
- Emoji slider: a 14u track (#e9ecef, radius 7u) in a 72u-tall area, filled with the accent
  up to the emoji (64u). Dragging pauses the story; letting go answers (0–100). Afterwards
  the emoji stays where it was let go and a 28u accent dot marks the average.
- Link: a white pill, height 84u, radius 42u, the label at 30u bold in the accent colour,
  then " ↗". Tapping it works exactly like the story button (`cta_click`, the same link
  rules and `onCtaClick` handler).
- Countdown: the title in the accent colour at 28u semibold, then four boxes (days, hours,
  mins, secs): the number at 56u bold #111, the unit at 18u #868e96 below. Once ended, the
  boxes become "Ended" at 40u bold. It updates every second and takes no taps.

**Answering.** Taps and drags on a sticker never move between stories. An answer is sent
with `POST /v1/answers?token=…` (text/plain JSON `{ storyId, interactionId, value, viewer? }`,
`viewer` only when reach counting is on) and returns `{ results: { total, counts? |
average? } }`. The SDK keeps each answer and its results in storage under `answers` (at
most `answersMaxIds`, oldest dropped first) so a story shows the person's answer when they
come back. If sending fails, the answer is still shown, without results.

## Changing a rule

The expected results were generated from the TypeScript SDKs' code and reviewed. To change
a rule:

1. Change it in `@stories/core` (and its own unit tests).
2. Add or adjust the cases here (a case with only `input` is filled in on the next step).
3. Run `pnpm --filter @stories/core spec:update` to rewrite `expect` from the code, and
   review the diff: every changed line is a behaviour change other SDKs must follow.
4. Bump `@stories/core`'s version. The Web and React Native SDKs pin the exact core version
   they were tested with (`"@stories/core": "workspace:<version>"`), so each one picks up
   the change only when it's moved to the new version, tested and released.
5. Each other SDK updates to pass the new cases before its next release.

Never edit `expect` by hand to make a failing SDK pass.
