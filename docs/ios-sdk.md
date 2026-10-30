# iOS SDK integration

Show Instagram-style stories in your native iOS app, in SwiftUI or UIKit. The SDK is a
`StoriesBar` view: a row of circles that opens a full-screen story viewer, styled from the
dashboard. It behaves exactly like the Web, React Native and Flutter SDKs: all of them pass the
same behaviour spec (`spec/`), including the analytics. It has no dependencies beyond Apple's
frameworks.

- [1. Add your app](#1-add-your-app) · [2. Copy your token](#2-copy-your-token) ·
  [3. Install](#3-install) · [4. Start the SDK](#4-start-the-sdk) ·
  [5. Place the story bar](#5-place-the-story-bar)
- [Options](#options) · [Callbacks](#callbacks) · [Opening stories from code](#opening-stories-from-code) ·
  [UIKit](#uikit) · [Sharing](#sharing) · [Theming](#theming) · [Viewer behaviour](#viewer-behaviour) ·
  [Accessibility](#accessibility) · [Analytics and privacy](#analytics-and-privacy) ·
  [Example app](#example-app) · [Troubleshooting](#troubleshooting)

Requirements: iOS 15 or newer, Xcode 15 or newer (Swift 5.9).

---

## 1. Add your app

In the dashboard, open **Settings → Apps & websites → Add app or website → Mobile app** and
enter your iOS bundle ID. One app covers both iOS and Android, whichever SDK each uses.

If your stories link into your app (e.g. `northline://article/42`), add the scheme (`northline`)
in the app's **General** tab. Story buttons only open `https://`, `http://` or your own schemes.

## 2. Copy your token

Each app has a **public token** like `pk_live_8fKq2…`, on its **Overview** tab. It's safe to ship
inside your app: it can only read your published stories and send analytics.

Local demo token (after `pnpm db:seed`): `pk_live_DemoMobileAppToken000000`

## 3. Install

In Xcode: **File → Add Package Dependencies…**, enter `https://github.com/lunasmedia/storyrings`, and add the
`StoryRings` library to your app target.

```swift
// Or in a Package.swift
.package(url: "https://github.com/lunasmedia/storyrings", from: "0.1.0")
```

The package includes a privacy manifest (`PrivacyInfo.xcprivacy`), so there's nothing to add to
yours for it.

## 4. Start the SDK

Start it when the app launches, so app sessions (active users) are counted even before a story
bar is on screen:

```swift
import StoryRings

@main
struct NewsApp: App {
    init() {
        StoriesClient.start(token: "pk_live_…", apiURL: "https://stories.example.com")
    }
    var body: some Scene { WindowGroup { ContentView() } }
}
```

In a UIKit app, call it in `application(_:didFinishLaunchingWithOptions:)`.

## 5. Place the story bar

```swift
ScrollView {
    StoriesBar(token: "pk_live_…", apiURL: "https://stories.example.com")
    // the rest of your screen
}
```

It works in a `ScrollView`, `List` or `VStack`. Publish a story group in the dashboard and
reopen the app. The bar shows nothing while nothing is live, so it's safe to ship before your
first story.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `token` | `String` | required | Public token |
| `apiURL` | `String` | required | Your Stories server |
| `bar` | `String?` | the main bar | Which story bar to show, by its key (Settings → Apps & websites → your app → Story bars) |
| `tags` | `[String]` | none | The person's tags from your own user data, e.g. `["london", "premium"]`. Groups with an audience (Edit group → Audience) only show to people whose tags pass it; changing them reloads the feed. Never personal data such as emails or IDs ([more](web-sdk.md#audience-and-tags)) |
| `analytics` | `Bool` | `true` | Send analytics events |
| `reach` | `Bool` | `true` | Count unique viewers with an anonymous ID kept on the device. Pass `false` until the person consents if your privacy rules require it; turning it off deletes the ID |
| `storage` | `KeyValueStorage?` | UserDefaults | Where watched stories, the last feed and the anonymous ID are kept. `MemoryStorage()` keeps nothing between launches |
| `theme` | `StoriesTheme` | see [Theming](#theming) | |
| `transition` | `StoriesTransition` | `.zoom` | How the viewer opens and closes: `.zoom` springs out of the tapped circle and goes back into the circle of the group being watched (sliding instead when that circle isn't on screen, e.g. a group opened from code), or `.slide` slides up from the bottom and shrinks away towards the bottom |
| `controller` | `StoriesBarController?` | | See [Opening stories from code](#opening-stories-from-code) |

Bars with the same token share one feed request, watched state and analytics queue.

## Callbacks

Callbacks are modifiers on the bar:

| Modifier | Argument | Notes |
|---|---|---|
| `.onLoad { groups in }` | live groups | Once the feed loads (can be empty) |
| `.onFail { error in }` | `StoriesError` | `error.code`: `invalid_token`, `unknown_bar`, `network`, `server`, `invalid_response`. The bar shows nothing, except stories from the last launch when offline |
| `.onStoryOpen { event in }` | `StoryOpenEvent` | Every time a story starts |
| `.onClose { reason in }` | `.user` / `.completed` | |
| `.onCtaClick { event in }` | `CtaClickEvent` (`url`, `label`, `groupId`, `storyId`, `close()`) | Return `.handled` to handle the link yourself, e.g. navigate inside your app; `.default` lets the SDK open it |
| `.onShare { event in }` | `ShareEvent` (`url`, `title`, `groupId`, `storyId`) | Return `.handled` to share yourself; `.default` shows the system share sheet |

```swift
StoriesBar(token: "pk_live_…", apiURL: "https://stories.example.com")
    .onCtaClick { event in
        guard event.url.hasPrefix("northline://") else { return .default }
        event.close()
        router.open(URL(string: event.url)!)
        return .handled
    }
```

## Opening stories from code

```swift
@State private var stories = StoriesBarController()   // in @State, so it outlives view updates
// …
StoriesBar(token: "…", apiURL: "…", controller: stories)
// …
stories.open("8f3a…") // a group id, e.g. from a push notification or a deep link
```

`open()` returns `false` until the feed has loaded or if the group isn't live. The controller
also has `close()`, `refresh()` (e.g. from `.refreshable`) and `groups`.

## UIKit

`StoriesBarView` is the same bar as a `UIView`. It sizes itself to its content (nothing while
there are no live stories), so it fits a `UIStackView` or Auto Layout without a height
constraint:

```swift
let stories = StoriesBarView(token: "pk_live_…", apiURL: "https://stories.example.com")
stories.onCtaClick = { event in router.open(event.url); return .handled }
stackView.addArrangedSubview(stories)
// stories.tags = ["london"]   // reloads the feed
// stories.open(groupId)        // from a push notification
```

It needs to be inside a view controller's view, which presents the viewer.

## Sharing

Turn on **Sharing** for your app in the dashboard and set its **share link**, e.g.
`https://news.example.com/stories/{group}/{story}`. The viewer then shows a Share button that
opens the system share sheet with the story's link. Use a link your app opens (universal
links), so people with the app land on the story and others reach your website; when your app
opens from it, read the ids and call `controller.open(groupId)`. Completed shares count as
`share` events in Analytics.

## Theming

The ring, badge, title and the items' shape and size come from the dashboard (Story bar style,
each story bar's style, and Edit group), so they change without an app release. Your code sets
the rest:

```swift
StoriesBar(
    token: "…", apiURL: "…",
    theme: StoriesTheme(
        circleSize: 72,          // until the dashboard sets a shape and size
        gap: 14,
        barPadding: 16,
        titleSize: 12,
        titleFontName: "Inter"
    )
)
```

Titles use the system's primary text colour (light and dark mode) unless the dashboard sets one.

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

- Opening and closing follow `transition` (default `.zoom`), carrying on from wherever a swipe down left the story. The app behind is never dimmed. With Reduce Motion on, both are a short fade.
- Tap the right 70% for the next story, the left 30% for the previous one; swipe left/right for
  the next/previous group; swipe down to close; press and hold to pause.
- The story button looks as chosen in the studio's CTA tab: a button (white, dark or outline)
  or a swipe up. With a swipe up, swiping up anywhere on the story opens its link too, the same
  as tapping it (a `cta_click`, through `onCtaClick` first).
- Images show for their duration (5 s by default); videos for their length, muted until
  unmuted (remembered for the session).
- The viewer starts each group at its first unseen story, and pauses while the app is in the
  background.
- Animated (GIF) covers play as a looping muted video in the bar.

## Accessibility

Circles are buttons labelled like "Sale, 3 stories, viewed". VoiceOver announces each story's
position and alt text; the story has Previous story / Next story actions, buttons have labels,
and the escape gesture (two-finger scrub) closes the viewer. With Reduce Motion on, ring
animations, animated covers and the viewer's transitions are off.

## Analytics and privacy

The SDK sends the same events as the other SDKs (definitions in [metrics.md](metrics.md)):
impressions, opens, views, taps, completions, button clicks and shares, plus `app_open` when an
app session starts (for active users, which billing uses). Events are batched every 5 seconds
and sent when the app goes to the background.

The anonymous viewer ID is random, made on the device, and replaced after 13 months; the server
only keeps a hash of it. There's no IDFA and no App Tracking Transparency prompt. The included
privacy manifest declares product interaction and a device ID for analytics, not linked to the
person and not used for tracking, and UserDefaults access (reason CA92.1). Use the same answers
in your App Store privacy details.

## Example app

`apps/example-ios` shows the bar in SwiftUI and UIKit against the local demo workspace, with a
switch for the `london` tag and opening a group from code. Open `StoriesExample.xcodeproj` and
run it on a simulator (start the API first with `pnpm dev`). On an iPhone, keep it on the
same Wi-Fi as your computer: device builds point at your computer's network address
automatically (a build step writes it in), and the app asks for Local Network access the first
time; allow it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing shows | Check `.onFail`. `invalid_token`: copy the token again. No error: no live story groups in this story bar |
| `unknown_bar` | The `bar` key doesn't exist for this app; check the Story bars tab |
| `network` with an `http://` server | App Transport Security blocks plain HTTP except to `localhost`; use `https://` |
| `network` on an iPhone during development | `localhost` there is the phone itself: use your computer's network address (e.g. `http://192.168.0.20:4000`), keep both on the same Wi-Fi, and allow Local Network access (Settings → Privacy & Security → Local Network) |
| `open()` does nothing | Keep the controller in `@State` (or a view model), not a plain `let` in the view |
| A story button does nothing | Its link must be `https://`, `http://` or one of your app's deep-link schemes |
| No Share button | Turn on Sharing and set a share link for the app |
