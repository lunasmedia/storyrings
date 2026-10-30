# Flutter SDK integration

Show Instagram-style stories in your Flutter app on iOS and Android. The SDK is a single
`StoriesBar` widget: a row of circles that opens a full-screen story viewer, styled from the
dashboard. It behaves exactly like the Web and React Native SDKs: all of them pass the same
behaviour spec (`spec/`), including the analytics.

- [1. Add your app](#1-add-your-app) · [2. Copy your token](#2-copy-your-token) ·
  [3. Install](#3-install) · [4. Start the SDK](#4-start-the-sdk) ·
  [5. Place the story bar](#5-place-the-story-bar)
- [Options](#options) · [Callbacks](#callbacks) · [Opening stories from code](#opening-stories-from-code) ·
  [Sharing](#sharing) · [Theming](#theming) · [Viewer behaviour](#viewer-behaviour) ·
  [Accessibility](#accessibility) · [Analytics and privacy](#analytics-and-privacy) ·
  [Example app](#example-app) · [Troubleshooting](#troubleshooting)

Requirements: Flutter 3.22 or newer (Dart 3.4), iOS 13+, Android 7 (API 24)+.

---

## 1. Add your app

In the dashboard, open **Settings → Apps & websites → Add app or website → Mobile app** and
enter your iOS bundle ID and/or Android package name. One app covers both iOS and Android.

If your stories link into your app (e.g. `northline://article/42`), add the scheme (`northline`)
in the app's **General** tab. Story buttons only open `https://`, `http://` or your own schemes.

## 2. Copy your token

Each app has a **public token** like `pk_live_8fKq2…`, on its **Overview** tab. It's safe to ship
inside your app: it can only read your published stories and send analytics.

Local demo token (after `pnpm db:seed`): `pk_live_DemoMobileAppToken000000`

## 3. Install

```yaml
# pubspec.yaml
dependencies:
  stories_sdk: ^0.1.0
```

It brings `http`, `shared_preferences`, `video_player`, `url_launcher` and `share_plus`.

**Android release builds** need internet access in `android/app/src/main/AndroidManifest.xml`
(debug builds have it already):

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

## 4. Start the SDK

Start it when the app launches, so app sessions (active users) are counted even before a story
bar is on screen:

```dart
void main() {
  WidgetsFlutterBinding.ensureInitialized();
  StoriesClient.start(token: 'pk_live_…', apiUrl: 'https://stories.example.com');
  runApp(const MyApp());
}
```

## 5. Place the story bar

```dart
ListView(children: [
  const StoriesBar(token: 'pk_live_…', apiUrl: 'https://stories.example.com'),
  // the rest of your screen
])
```

Publish a story group in the dashboard and reopen the app. The bar shows nothing while nothing
is live, so it's safe to ship before your first story.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `token` | `String` | required | Public token |
| `apiUrl` | `String` | required | Your Stories server |
| `bar` | `String?` | the main bar | Which story bar to show, by its key (Settings → Apps & websites → your app → Story bars) |
| `tags` | `List<String>` | none | The person's tags from your own user data, e.g. `['london', 'premium']`. Groups with an audience (Edit group → Audience) only show to people whose tags pass it; changing them reloads the feed. Never personal data such as emails or IDs ([more](web-sdk.md#audience-and-tags)) |
| `analytics` | `bool` | `true` | Send analytics events |
| `reach` | `bool` | `true` | Count unique viewers with an anonymous ID kept on the device. Pass `false` until the person consents if your privacy rules require it; turning it off deletes the ID |
| `storage` | `KeyValueStorage?` | SharedPreferences | Where watched stories, the last feed and the anonymous ID are kept. `MemoryStorage()` keeps nothing between launches |
| `theme` | `StoriesTheme` | see [Theming](#theming) | |
| `transition` | `StoriesTransition` | `slide` | How the viewer opens and closes: `slide` slides up from the bottom and shrinks away towards the bottom, or `zoom` springs out of the tapped circle and goes back into the circle of the group being watched (sliding instead when that circle isn't on screen, e.g. a group opened from code) |
| `controller` | `StoriesBarController?` | | See [Opening stories from code](#opening-stories-from-code) |

Bars with the same token share one feed request, watched state and analytics queue.

## Callbacks

| Callback | Argument | Notes |
|---|---|---|
| `onLoad(groups)` | live groups | Once the feed loads (can be empty) |
| `onFail(error)` | `StoriesException` | `error.code`: `invalid_token`, `unknown_bar`, `network`, `server`, `invalid_response`. The bar shows nothing, except stories from the last launch when offline |
| `onStoryOpen(e)` | `StoryOpenEvent` | Every time a story starts |
| `onClose(reason)` | `CloseReason.user` / `.completed` | |
| `onCtaClick(e)` | `CtaClickEvent` (`url`, `label`, `groupId`, `storyId`, `close()`) | Return `false` to handle the link yourself, e.g. navigate inside your app. Otherwise the SDK opens it |
| `onShare(e)` | `ShareEvent` (`url`, `title`, `groupId`, `storyId`) | Return `false` to share yourself; otherwise the system share sheet opens |

```dart
StoriesBar(
  token: 'pk_live_…',
  apiUrl: 'https://stories.example.com',
  onCtaClick: (e) {
    if (e.url.startsWith('northline://')) {
      e.close();
      router.go(Uri.parse(e.url).path);
      return false;
    }
    return null;
  },
)
```

## Opening stories from code

```dart
final stories = StoriesBarController();
// …
StoriesBar(token: '…', apiUrl: '…', controller: stories)
// …
stories.open('8f3a…'); // a group id, e.g. from a push notification or a deep link
```

`open()` returns `false` until the feed has loaded or if the group isn't live. The controller
also has `close()`, `refresh()` and `groups`.

## Sharing

Turn on **Sharing** for your app in the dashboard and set its **share link**, e.g.
`https://news.example.com/stories/{group}/{story}`. The viewer then shows a Share button that
opens the system share sheet with the story's link. Use a link your app opens (iOS universal
links / Android App Links), so people with the app land on the story and others reach your
website; when your app opens from it, read the ids and call `controller.open(groupId)`.
Completed shares count as `share` events in Analytics.

## Theming

The ring, badge, title and the items' shape and size come from the dashboard (Story bar style,
each story bar's style, and Edit group), so they change without an app release. Your code sets
the rest:

```dart
StoriesBar(
  token: '…',
  apiUrl: '…',
  theme: const StoriesTheme(
    circleSize: 72,      // until the dashboard sets a shape and size
    gap: 14,
    barPadding: 16,
    titleSize: 12,
    titleStyle: TextStyle(fontFamily: 'Inter'),
  ),
)
```

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

- Opening and closing follow `transition` (default `slide`), carrying on from wherever a swipe down left the story. The app behind is never dimmed. With reduced motion, both are a short fade.
- Tap the right 70% for the next story, the left 30% for the previous one; swipe left/right for
  the next/previous group; swipe down or Back to close; press and hold to pause.
- The story button looks as chosen in the studio's CTA tab: a button (white, dark or outline)
  or a swipe up. With a swipe up, swiping up anywhere on the story opens its link too, the same
  as tapping it (a `cta_click`, through `onCtaClick` first).
- Images show for their duration (5 s by default); videos for their length, muted until
  unmuted (remembered for the session).
- The viewer starts each group at its first unseen story, and pauses while the app is in the
  background.

## Accessibility

Animated (GIF) covers play as a looping muted video, except with Reduce Motion on.

Circles are buttons labelled like "Sale, 3 stories, viewed". The viewer announces each story's
position and alt text, its buttons have labels, and screen readers get Previous / Next actions.
With Reduce Motion on, ring animations and the viewer's transitions are off.

## Analytics and privacy

The SDK sends the same events as the other SDKs (definitions in [metrics.md](metrics.md)):
impressions, opens, views, taps, completions, button clicks and shares, plus `app_open` when an
app session starts (for active users, which billing uses). Events are batched every 5 seconds
and sent before the app is suspended.

The anonymous viewer ID is random, made on the device, and replaced after 13 months; the server
only keeps a hash of it. There's no advertising ID and no tracking prompt. For your App Store
privacy details and Google Play Data safety form: app activity (product interaction) and an
app-generated identifier, not linked to the person's identity, not used for tracking, not
shared or sold.

## Example app

`apps/example-flutter` shows the bar against the local demo workspace, with a switch for the
`london` tag and opening a group from code. See its README to run it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing shows | Check `onFail`. `invalid_token`: copy the token again. No error: no live story groups in this story bar |
| `unknown_bar` | The `bar` key doesn't exist for this app; check the Story bars tab |
| Works in debug, not release (Android) | Add the `INTERNET` permission (step 3) |
| A story button does nothing | Its link must be `https://`, `http://` or one of your app's deep-link schemes |
| No Share button | Turn on Sharing and set a share link for the app |

