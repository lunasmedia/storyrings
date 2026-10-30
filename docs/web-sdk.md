# Web SDK integration

Show Instagram-style stories on any website. The SDK is framework-free, and the story bar is under
12 KB gzipped: the viewer downloads only when a visitor goes to open a story. It renders in a Shadow DOM so your CSS can't break it (and its CSS can't affect your page).

- [1. Add your website](#1-add-your-website)
- [2. Copy your token](#2-copy-your-token)
- [3. Install](#3-install)
- [4. Initialize](#4-initialize)
- [5. Place the story bar](#5-place-the-story-bar)
- [React](#react) · [Custom element](#custom-element) · [Options](#options-reference) ·
  [Callbacks](#callbacks) · [Theming](#theming) · [Accessibility](#accessibility) ·
  [Troubleshooting](#troubleshooting)

---

## 1. Add your website

In the dashboard, open **Apps & Websites → Add → Website**. The website URL is **optional**, but
browsers are only ever served on domains you've registered:

- **With a URL** (e.g. `https://shop.example.com`): the SDK loads on that origin. Add more,
  such as staging or `http://localhost:5173`, under **Settings → Allowed origins**.
- **Without a URL:** requests from your own server work straight away (they send no `Origin`), but
  every website is refused until you add a domain. Nobody can reuse your token on another site.

Story buttons (CTAs) on a website link with `https://` or `http://` only. Websites don't
open your mobile apps: the apps have their own stories, so deep-link schemes are for mobile
apps only.

## 2. Copy your token

Each website has a **public token** like `pk_live_8fKq2…`. It's safe to put in client-side code:
it can only read your published stories and send analytics, and only from your allowed origins.
If you need to, you can rotate it in the dashboard.

Local demo token (after `pnpm db:seed`): `pk_live_DemoWebsiteToken00000000`

## 3. Install

**Option A: script tag** (no build step)

```html
<script src="https://YOUR-STORIES-HOST/sdk/v1/stories.js" defer></script>
```

This defines `window.Stories` and the `<stories-bar>` element. By default the API URL is the
host that served the script. Override it with `data-api-url="…"` on the script tag.

**Option B: npm**

```bash
npm install @lunasmedia/storyrings-web          # or: @lunasmedia/storyrings-react for React apps
```

## 4. Initialize

```js
// Script tag: window.Stories. npm: import { init } from '@lunasmedia/storyrings-web'
const stories = Stories.init({
  token: 'pk_live_…',
  // apiUrl: 'https://…', // only for your own server: npm defaults to the hosted service,
  //                        // the script tag to the host that served it
});
```

Create one client per token and reuse it for every bar on the page.

## 5. Place the story bar

```html
<div id="stories"></div>
<script>
  const bar = stories.mount('#stories', {
    theme: { circleSize: 72 },
    onCtaClick: (e) => {
      if (e.url.startsWith(location.origin)) {
        router.push(new URL(e.url).pathname); // same-site links through your router…
        return false;                         // …and stop the SDK from navigating
      }
    },
  });
</script>
```

That's it. The bar loads your published story groups, shows a loading skeleton while it does,
and hides itself if there's nothing to show.

---

## React

```bash
npm install @lunasmedia/storyrings-react
```

```tsx
import { StoriesBar } from '@lunasmedia/storyrings-react';

export function Home() {
  const navigate = useNavigate();
  return (
    <StoriesBar
      token="pk_live_…"
      theme={{ circleSize: 72, ringColors: ['#ff5f6d', '#ffc371'] }}
      onCtaClick={(e) => {
        if (e.url.startsWith('/')) {
          e.close();
          navigate(e.url);
          return false;
        }
      }}
    />
  );
}
```

- Callbacks can change on every render without remounting the bar.
- Changing `token`, `apiUrl` or `analytics` remounts it.
- Theme objects are compared by value.
- A `ref` gives you the handle (`open`, `close`, `refresh`, `groups`).
- The component is client-only and SSR-safe: it renders an empty `<div>` on the server and mounts
  in the browser.

## Custom element

```html
<stories-bar token="pk_live_…" circle-size="64" ring-colors="#ff5f6d,#ffc371" hide-titles></stories-bar>

<script>
  const el = document.querySelector('stories-bar');
  el.addEventListener('stories-cta', (e) => {
    e.preventDefault();               // handle the link yourself
    console.log(e.detail.url);
  });
</script>
```

| Attribute | Theme option |
|---|---|
| `token`, `api-url`, `bar`, `cta-target`, `transition` | see [Options](#options-reference) |
| `circle-size`, `ring-width`, `ring-gap`, `ring-colors` (comma-separated), `seen-ring-color` | ring & circle |
| `title-color`, `title-font`, `title-size`, `hide-titles` | titles |
| `bar-padding`, `gap` | spacing |

Events: `stories-load`, `stories-fail`, `stories-open`, `stories-close`, `stories-cta` and
`stories-share` (the last two are cancelable). Each event's `detail` matches the corresponding
callback's argument.

---

## Options reference

`init(options)`

| Option | Type | Default | |
|---|---|---|---|
| `token` | `string` | required | Public token |
| `apiUrl` | `string` | script origin | Your Stories server |
| `analytics` | `boolean` | `true` | Send impression/view/click events |
| `storage` | `{ getItem, setItem } \| null` | `localStorage` | Where "viewed" state, the last loaded feed (the feed lets a reload show the bar instantly) and the anonymous viewer ID are kept. `null` disables all three |
| `reach` | `boolean` | `true` | Count unique viewers with an anonymous ID kept in `storage` ([how](metrics.md#people-reach)). Pass `false` until consent if your privacy rules require it, then call `client.setReach(true)`. `setReach(false)` deletes the ID |

`client.mount(target, options)` returns a handle with `open(groupIdOrIndex)`, `close()`,
`refresh()`, `update(options)`, `destroy()` and `groups`.

| Option | Type | Default | |
|---|---|---|---|
| `bar` | `string` | the main bar | Which [story bar](#story-bars) to show, by its key |
| `tags` | `string[]` | none | The viewer's tags, for [audiences](#audience-and-tags). Change with `update({ tags })` |
| `theme` | `Partial<StoriesTheme>` | see below | |
| `ctaTarget` | `'_self' \| '_blank'` | `'_self'` | How CTA links open if you don't handle them |
| `transition` | `'slide' \| 'zoom'` | `'slide'` | How the full-screen viewer opens and closes: `'slide'` slides up from the bottom and shrinks away towards the bottom, or `'zoom'` springs out of the clicked circle and goes back into the circle of the group being watched (sliding instead when that circle isn't on screen, e.g. a group opened from code). Embedded viewers don't animate |
| `openSharedLinks` | `boolean` | `true` | Open the story a [shared link](#sharing) points to when the page loads |
| `onLoad` … `onShare` | functions | | See [Callbacks](#callbacks) |

## Story bars

One website can show different stories in different places, for example the home page and
product pages. Each place is a **story bar** with its own selection of groups (a group can be
in several) and, optionally, its own style. Create them under **Settings → Apps & websites**,
pick which groups each shows in **Content**, then name the bar's key in the embed:

```html
<stories-bar token="pk_live_…"></stories-bar>                     <!-- main bar -->
<stories-bar token="pk_live_…" bar="product-page"></stories-bar>  <!-- another bar -->
```

```js
stories.mount('#pdp-stories', { bar: 'product-page' });
```

Leaving out `bar` shows the main bar, so embeds installed before story bars existed keep
working. Keys never change once created. An unknown key calls `onFail` with the code
`unknown_bar`. Bars on one page share a client: one page view, one analytics queue. Each
event records its bar, so Analytics can be filtered by story bar.

## Audience and tags

Show a story group only to some people, such as everyone in London:

1. Your site passes tags for the person viewing, from your own user data (their city, plan,
   interests…):
   ```html
   <stories-bar token="pk_live_…" tags="london,premium"></stories-bar>
   ```
   ```js
   const bar = stories.mount('#stories', { tags: ['london', 'premium'] });
   bar.update({ tags: ['london'] }); // e.g. after sign-in; reloads the feed
   ```
   With React: `<StoriesBar token="pk_live_…" tags={['london']} />`.
2. In the dashboard, a group's **Edit group → Audience** sets its tag filter: a list of
   conditions that people must all pass (AND).
   - **Include** `london` `leeds`: people with any of these tags see the group.
   - **Exclude** `churned`: people with any of these tags don't.

   With no conditions, the group is shown to everyone. The feed only includes a filtered
   group for people who pass it; everyone else never receives it.

Tags are lowercase letters, numbers and `. _ : -` (up to 64 characters, 50 per person);
anything else is ignored. They're only used to filter the feed and aren't stored. Use labels
for groups of people, never emails or IDs. Tags are set by the page, so audiences are for
targeting, not for keeping stories secret.

## Callbacks

| Callback | Argument | Notes |
|---|---|---|
| `onLoad(groups)` | published groups | Called once the feed loads (can be empty) |
| `onFail(error)` | `StoriesError` | `error.code`: `invalid_token`, `origin_not_allowed`, `network`, `server`, `invalid_response`. The bar hides itself |
| `onStoryOpen(e)` | `{ groupId, storyId, groupIndex, storyIndex, groupTitle }` | Every time a story starts |
| `onClose(reason)` | `'user' \| 'completed'` | |
| `onCtaClick(e)` | `{ url, label, groupId, storyId, close() }` | Return `false` to stop the SDK from navigating |
| `onShare(e)` | `{ url, title, groupId, storyId }` | Return `false` to handle sharing yourself (e.g. your own share menu) |

## Sharing

Turn on **Settings → Story sharing** in the dashboard to add a Share button to the viewer.
No code change is needed.

- **What gets shared:** a link to the story on the page the viewer is on, e.g.
  `https://news.example.com/article#stories=<group>/<story>`. The fragment never reaches your
  server, so every page with a story bar can open shared links.
- **How:** the device's share sheet where the browser has one (most phones, Safari and some desktop browsers). Elsewhere
  the link is copied and the viewer shows "Link copied".
- **Opening a link:** when the page loads, the bar opens that story and removes the fragment
  from the address, so a refresh doesn't reopen it. Links to groups that are no longer live are
  ignored. Pass `openSharedLinks: false` to turn this off.
- **Analytics:** completed shares (share sheet sent, or link copied) count as `share` events.

## Theming

How each circle looks is set **in the dashboard**, without a deploy:
- **App-wide:** Settings → Story bar style. This styles the main bar.
- **Per story bar:** each story bar's settings page. Bars other than the main bar don't use the
  app-wide style: anything they don't set uses the built-in defaults.
- **Per group:** Edit group.
- **Shape & size (app-wide only):** Settings → Story bar style → Shape & size sets every item's
  width, height, corner rounding (circle, rounded, square, portrait card…) and spacing. Groups
  can't override it. Once set, it takes precedence over `circleSize` and `gap` in your code;
  until then, your code's size is used.

That covers the ring (style, colours, thickness, gap, seen colour, animation), badges and title
styling, and the feed sends the result for every group. Your code controls **layout**:

| Option | Default | |
|---|---|---|
| `circleSize` | `68` | Circle diameter in px (32–160), unless Shape & size is set in the dashboard |
| `titleFont` / `titleSize` | inherit / `12` | |
| `barPadding` / `gap` | `12` / `14` | px (`gap` too is replaced by the dashboard's spacing when set) |

`ringColors`, `ringWidth`, `ringGap`, `seenRingColor`, `titleColor` and `hideTitles` are only used
as a fallback when the server sends no appearance (older servers). Dashboard settings take
precedence.

- **Gap colour:** "Match background" uses the page background (`Canvas`). Set
  `--stories-ring-gap-color` on the container if your bar sits on a coloured background.
- **Animated (GIF) covers** play as a muted, looping video. They show a still poster while
  loading, for people who prefer reduced motion, and on Save-Data or 2G connections.
- **Ring animations** are switched off when the user prefers reduced motion.

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

Opening and closing follow `transition` (default `'slide'`), carrying on from wherever a swipe down left the story. On phones the page shows around the story as it moves; on larger screens the story opens in a frame over a dark backdrop that fades in and out with it. With reduced motion, both are a short fade.

| Input | Action |
|---|---|
| Tap right ⅔ / left ⅓ | Next / previous story |
| Press and hold | Pause (release to resume) |
| Swipe left / right | Next / previous group |
| Swipe down, or click outside (desktop) | Close |
| Swipe up (when the story button is a swipe up) | Opens the button's link, like tapping it |
| `→` / `←` | Next / previous story |
| `Shift`+`→`/`←`, `PageDown`/`PageUp` | Next / previous group |
| `Space` or `K` / `M` / `Esc` | Pause / mute / close |

- Videos autoplay muted. Once the viewer unmutes, the choice is remembered for the rest of the
  page visit.
- Stories pause while the tab is hidden.
- Groups reopen at the first story you haven't seen.

## Accessibility

- Circles are real buttons with labels like "New in, 3 stories, viewed".
- The viewer is a modal `dialog` that traps focus and returns it to the circle on close.
- All controls (previous, next, share, pause, mute, close, CTA) are keyboard-reachable buttons.
- "Link copied" is announced through a status message.
- A polite live region announces "New in: story 2 of 3" plus the story's alt text.
- `prefers-reduced-motion` turns off animations.

## Analytics

The SDK batches `impression` (circle at least 50% visible for one continuous second, once per
page view), `group_open`, `story_view` (once the story has appeared on screen), `cta_click`,
`group_complete` and `share` events. Definitions and formulas: [metrics.md](metrics.md). It sends them every 5 s
and with `sendBeacon` when the page is hidden. Counts appear in the dashboard. Pass
`analytics: false` to turn this off.

### Page views and active users

`Stories.init()` records a **page view** when the page loads, with the visitor's platform (desktop
or mobile web; tablets count as mobile web). These feed the dashboard's Audience section: Page
views and Website visitors (split into desktop and mobile web), and Website story reach rate, the
share of visitors who viewed at least one story.

- **For accurate site-wide numbers,** load the script and call `init` on **every page**, including
  pages without a story bar. `init` without `mount` only records the page view:

  ```html
  <script src="https://YOUR-STORIES-HOST/sdk/v1/stories.js" defer></script>
  <script>addEventListener('DOMContentLoaded', () => Stories.init({ token: 'pk_live_…' }));</script>
  ```
- **Single-page apps** (React Router, Next.js client navigation…) don't reload the page. Call
  `client.trackPageView()` on each route change.
- **One page view per page load:** several bars or clients with the same token on one page still
  count once.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `onFail` with `origin_not_allowed` | Add the page's origin (scheme + host + port) to **Allowed origins**. Websites with no allowed origins are refused everywhere |
| `onFail` with `invalid_token` | The token was rotated or mistyped |
| Bar never appears | Nothing is live. In **Content**, switch a group on. It needs a cover and at least one published story, and must be inside its schedule |
| CTA button missing | Website buttons need an `https://` or `http://` link |
| Strict CSP | Allow `script-src` and `connect-src` for your Stories host, `img-src`/`media-src` for your media host, and `style-src 'unsafe-inline'` (styles are injected into the Shadow DOM) |
