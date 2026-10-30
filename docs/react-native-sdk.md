# React Native SDK integration

Show Instagram-style stories in your iOS and Android app. The SDK is a single `<StoriesBar>`
component: a row of circles that opens a full-screen story viewer. It uses React Native's own
views, gestures and animations; the only native dependencies are the video player and storage
that most apps already have.

- [1. Add your app](#1-add-your-app)
- [2. Copy your token](#2-copy-your-token)
- [3. Install](#3-install)
- [4. Place the story bar](#4-place-the-story-bar)
- [Props](#props) · [Callbacks](#callbacks) · [Opening stories from code](#opening-stories-from-code) ·
  [Theming](#theming) · [Viewer behaviour](#viewer-behaviour) · [Accessibility](#accessibility) ·
  [Analytics](#analytics) · [Example app](#example-app) · [Troubleshooting](#troubleshooting)

Requirements: React Native 0.79 or newer with the new architecture (tested with 0.86 / Expo SDK
57). Expo apps need a [development build](https://docs.expo.dev/develop/development-builds/introduction/):
Expo Go doesn't include the video player.

---

## 1. Add your app

In the dashboard, open **Apps & Websites → Add → Mobile app** and enter your iOS bundle ID
and/or Android package name (e.g. `com.example.news`). They're for your reference: apps send no
browser origin, so unlike websites there's no domain to register.

If your stories link into your app (e.g. `northline://article/42`), add the scheme (`northline`)
under **Settings → Deep-link schemes**. CTA buttons only accept `https://`, `http://` or a
registered scheme.

## 2. Copy your token

Each app has a **public token** like `pk_live_8fKq2…`. It's safe to ship inside your app: it can
only read your published stories and send analytics. If you need to, you can rotate it in the
dashboard.

Local demo token (after `pnpm db:seed`): `pk_live_DemoMobileAppToken000000`

## 3. Install

```bash
npx expo install @lunasmedia/storyrings-react-native react-native-video @react-native-async-storage/async-storage
# bare React Native: npm install … then cd ios && pod install
```

| Package | Needed for | Without it |
|---|---|---|
| `react-native-video` | Video stories and animated (GIF) covers | Video stories are skipped; covers show their still image |
| `@react-native-async-storage/async-storage` | Remembering watched stories between launches, and showing the bar instantly on launch | Remembered for the current session only |
| `react-native-safe-area-context` (optional) | Exact notch/home-indicator spacing in the viewer | Sensible defaults are used |

## 4. Place the story bar

```tsx
import { StoriesBar } from '@lunasmedia/storyrings-react-native';

export function HomeScreen() {
  return (
    <ScrollView>
      <StoriesBar token="pk_live_…" />
      {/* the rest of your screen */}
    </ScrollView>
  );
}
```

That's it: publish a story group in the dashboard and reopen the app. The bar renders nothing
while there's nothing live, so it's safe to ship before your first story.

## Props

| Prop | Type | Default | |
|---|---|---|---|
| `token` | `string` | required | Public token |
| `apiUrl` | `string` | `https://stories-dashboard.fly.dev` | Only for your own Stories server |
| `bar` | `string` | the main bar | Which story bar to show, by its key from Settings → Apps & websites. Each bar shows its own groups (see the [web docs](web-sdk.md#story-bars)) |
| `tags` | `string[]` | none | The person's tags from your own user data, e.g. `['london', 'premium']`. Groups with a tag filter (Edit group → Audience) only show to people whose tags pass it; changing them reloads the feed. Never pass personal data such as emails or IDs (see the [web docs](web-sdk.md#audience-and-tags)) |
| `analytics` | `boolean` | `true` | Send impression/view/click events |
| `storage` | `{ getItem, setItem } \| null` | AsyncStorage | Where watched stories, the last feed and the anonymous viewer ID are kept. `null` disables all three |
| `reach` | `boolean` | `true` | Count unique viewers with an anonymous ID kept in `storage` ([how](metrics.md#people-reach)). Set to `false` until the person consents if your privacy rules require it; turning it off deletes the ID. Needs AsyncStorage |
| `theme` | `Partial<StoriesTheme>` | see [Theming](#theming) | |
| `transition` | `'slide' \| 'zoom'` | `'slide'` | How the viewer opens and closes: `'slide'` slides up from the bottom and shrinks away towards the bottom, or `'zoom'` springs out of the tapped circle and goes back into the circle of the group being watched (sliding instead when that circle isn't on screen, e.g. a group opened from code) |
| `backgroundColor` | `string` | white, or black in dark mode | The screen colour behind the bar (used for the gap between ring and image) |
| `style` | `ViewStyle` | | Style for the bar's container |
| `onLoad` … `onClose` | functions | | See [Callbacks](#callbacks) |

Bars with the same token share one feed request, watched state and analytics queue.

## Callbacks

| Callback | Argument | Notes |
|---|---|---|
| `onLoad(groups)` | published groups | Called once the feed loads (can be empty) |
| `onFail(error)` | `StoriesError` | `error.code`: `invalid_token`, `network`, `server`, `invalid_response`. The bar renders nothing, except for `network`/`server` errors when stories from the last launch are available |
| `onStoryOpen(e)` | `{ groupId, storyId, groupIndex, storyIndex, groupTitle }` | Every time a story starts |
| `onClose(reason)` | `'user' \| 'completed'` | |
| `onCtaClick(e)` | `{ url, label, groupId, storyId, close() }` | Return `false` to handle the link yourself, e.g. navigate inside your app. Otherwise the SDK opens it with `Linking.openURL` |
| `onShare(e)` | `{ url, title, groupId, storyId }` | Share tapped (see [Sharing](#sharing)). Return `false` to share yourself; otherwise the SDK opens the share sheet |

```tsx
<StoriesBar
  token="pk_live_…"
  onCtaClick={({ url, close }) => {
    if (url.startsWith('northline://')) {
      close();
      navigation.navigate('Article', { url });
      return false;
    }
  }}
/>
```

## Sharing

Turn on **Story sharing** for your app in the dashboard (Settings → Apps & websites → your
app → Settings) and set its **share link**, e.g.
`https://news.example.com/stories/{group}/{story}`. The viewer then shows a Share button that
opens the phone's share sheet with the story's link (`{group}` and `{story}` filled in).

Use a link your app is set up to open (iOS universal links / Android App Links), so people
with the app land on the story and everyone else reaches your website. When your app opens
from it, read the ids from the URL and open the story:

```tsx
Linking.addEventListener('url', ({ url }) => {
  const [, groupId] = new URL(url).pathname.match(/^\/stories\/([^/]+)/) ?? [];
  if (groupId) stories.current?.open(groupId);
});
```

Pass `onShare` and return `false` to use your own share flow instead. Completed shares are
counted as `share` events in Analytics.

## Opening stories from code

Use a ref to open a group by id or index, e.g. from a push notification or a deep link:

```tsx
const stories = useRef<StoriesBarHandle>(null);
// …
<StoriesBar ref={stories} token="pk_live_…" />
// …
stories.current?.open('8f3a…'); // group id, or an index like 0
```

The handle also has `close()`, `refresh()` (refetch the feed) and `groups`. `open()` returns
`false` until the feed has loaded or if the group isn't live.

## Theming

How each circle looks is set **in the dashboard**, without an app release:
- **App-wide:** Settings → Story bar style.
- **Per group:** Edit group.
- **Shape & size (app-wide only):** Settings → Story bar style → Shape & size (circle, rounded,
  square, portrait card…). Once set, it takes precedence over `circleSize` and `gap` in your code.

That covers the ring (style, colours, thickness, gap, seen colour, animation), badges and title
styling. Your code controls **layout**:

| Option | Default | |
|---|---|---|
| `circleSize` | `68` | Circle diameter (32–160), unless Shape & size is set in the dashboard |
| `titleFont` / `titleSize` | system / `12` | `titleFont` is a font family name |
| `titleColor` | your app's text colour | Used when the dashboard title colour is "inherit" |
| `barPadding` / `gap` | `12` / `14` | (`gap` too is replaced by the dashboard's spacing when set) |

`ringColors`, `ringWidth`, `ringGap`, `seenRingColor` and `hideTitles` are only used as a
fallback when the server sends no appearance (older servers).

- **Gradients** use React Native's built-in gradient support (new architecture). Where it isn't
  available, rings fall back to their first colour.
- **Ring animations** (rotate, pulse, shimmer) run on the native thread, and switch off when
  the user turns on Reduce Motion.
- **Animated (GIF) covers** play as a muted, looping video, and show their still image with
  Reduce Motion or without `react-native-video`.

## Fitting the screen

Phones come in many shapes, so each story says how it fits the screen. You choose this per story
in the dashboard's studio, and the SDK follows it:

- **Fill screen** covers the whole screen. On screens of other shapes the edges are cut off (the
  sides on tall phones), so keep key content near the middle. Photos and videos start here.
- **Show whole** always shows all of the story. Any space around it (above and below on tall
  phones) shows colours taken from the story's top and bottom edges, so it blends in. Designs
  start here, so their text and interactive stickers are never cut off.

Best upload size: 1080 × 1920 px (9:16), or taller up to 1080 × 2400 (9:20). Interactive
stickers stay on the same spot of the story either way.

Text over videos: when text, shapes or emoji are added to a video in the studio, they come as a
transparent overlay image the SDK draws over the video (fitted the same way), under the
interactive stickers and controls. Nothing to set up; older SDK versions show the video alone.

## Interactive stickers

Stories designed in the dashboard's studio can carry interactive stickers, which the SDK draws
over the story at the place they were put, scaled with the image. Nothing to set up:

- **Poll** and **quiz**: a tap answers, then each option shows its share of the votes. A quiz
  shows the right answer in green, and a wrong pick in red.
- **Emoji slider**: dragging holds the story; letting go answers and marks the average.
- **Link**: works exactly like the story button. It counts as a button tap and goes through
  `onCtaClick` first.
- **Countdown**: counts down live to its date, then shows "Ended".

Taps and drags on a sticker never move between stories. Answers are sent to the Stories API with
the anonymous viewer ID when reach counting is on (so one person counts once), and kept on the
device, so a story shows the person's answer when they come back. Results show in the studio.

## Viewer behaviour

Opening and closing follow `transition` (default `'slide'`), carrying on from wherever a swipe down left the story; the app behind is never dimmed. With Reduce Motion on, both are a short fade.

| Input | Action |
|---|---|
| Tap right ⅔ / left ⅓ | Next / previous story |
| Press and hold | Pause (release to resume) |
| Swipe left / right | Next / previous group |
| Swipe down, ✕, or Android Back | Close |
| Swipe up (when the story button is a swipe up) | Opens the button's link, like tapping it |

- **Navigation** follows the same rules as the web SDK (they share their logic): groups reopen
  at the first story you haven't seen; going back from a group's first story shows the previous
  group's last story.
- **No black flashes:** the current story stays on screen until the next one has loaded. Nearby
  images are fetched ahead of time.
- **Video** plays muted until the viewer taps the sound button; that choice is kept while the app
  runs. The silent switch is respected on iOS.
- **Pausing:** stories pause while the app is in the background.
- **Full screen:** the status bar is hidden while the viewer is open, on both platforms.
- **Offline or server errors:** the bar keeps showing the stories from the last launch (pictures
  already viewed come from the device's cache), and the feed is fetched again when the app returns
  to the foreground. `onFail` is still called.

## Accessibility

- Circles are buttons with labels like "Breaking, 4 stories, viewed, NEW".
- The viewer is a modal: VoiceOver and TalkBack stay inside it.
- Previous and next story are buttons for screen-reader users (double-tap to activate), as are
  pause, sound, close and the story's link.
- The story position and its description ("Breaking: story 2 of 4. Storm warning…") are
  announced when a story starts.
- **iOS:** the two-finger scrub gesture closes the viewer, and the two-finger double-tap pauses it.
- Reduce Motion turns off ring animations, animated covers and the open/close fade.

## Analytics

The SDK batches `impression` (circle at least 50% on screen for one continuous second, once per
bar), `group_open`, `story_view` (once the story has appeared on screen), `cta_click` and
`group_complete` events ([definitions](metrics.md)), sends them every 5 seconds, and flushes
them when the app goes to the background. Counts appear in the dashboard. Pass
`analytics={false}` to turn this off.

### App sessions and active users

The SDK records an **app session** when it starts, and another when the app comes back to the
foreground after **30 minutes or more** in the background (the Firebase Analytics session rule).
These, with the platform (iOS or Android), feed the dashboard's Audience section: Active users (split
iOS / Android) and App story reach rate, the share of app users who viewed at least one story. App
sessions are recorded too, but not shown on the dashboard for now.

Start the SDK **when the app launches**, so sessions count even before the story bar is on screen
(or on screens without one). Bars with the same options share the started client:

```tsx
import { startStories } from '@lunasmedia/storyrings-react-native';

startStories({ token: 'pk_live_…' }); // e.g. in index.js
```

## Example app

`apps/example-rn` is an Expo app ("Northline News") that shows the bar above a list of articles.

```bash
pnpm dev                              # API, dashboard and web SDK (keep running)
cd apps/example-rn
npx expo run:ios                      # or: npx expo run:android (first build takes a few minutes)
```

- It reaches the Stories API on the computer running Expo, so it works in the iOS Simulator,
  the Android emulator and on a phone on the same Wi-Fi.
- It uses the demo mobile app's token. To try it with another app's stories, start Expo with
  `EXPO_PUBLIC_STORIES_TOKEN=pk_live_… npx expo start --dev-client`. Set
  `EXPO_PUBLIC_STORIES_ANALYTICS=off` to test without counting views.
- `storiesexample://stories/0` (or a group id) opens a group, like a notification would.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `onFail` with `network` | The app can't reach `apiUrl`. On the Android emulator, `localhost` is the emulator itself: use your computer's network address. Plain `http://` works in debug builds; use `https://` in release builds |
| `onFail` with `invalid_token` | The token was rotated or mistyped |
| Bar never appears | Nothing is live. In **Content**, switch a group on. It needs a cover and at least one published story, and must be inside its schedule |
| Video stories are skipped | Install `react-native-video` and rebuild the app (Expo Go can't load it) |
| Watched rings reset on every launch | Install `@react-native-async-storage/async-storage` and rebuild |
| CTA button missing | The link uses a scheme that isn't registered for the app |
