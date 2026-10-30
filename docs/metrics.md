# Metrics: definitions and how they're measured

Every number in the dashboard comes from six events the SDKs send. This page defines them,
the rates worked out from them, and exactly how the web and React Native SDKs measure each one.

The wording shown in the dashboard ("How these are measured" on Home) comes from
`packages/contracts/src/metrics.ts`. Change definitions there and here together.

- [Counts](#counts)
- [People (reach)](#people-reach)
- [Audience (active users, page views, sessions)](#audience-active-users-page-views-sessions)
- [Bot filtering (invalid traffic)](#bot-filtering-invalid-traffic)
- [Rates](#rates)
- [How the SDKs measure each event](#how-the-sdks-measure-each-event)
- [Industry definitions we follow](#industry-definitions-we-follow)
- [Changes](#changes)

---

## Counts

| Metric | Event | Definition |
|---|---|---|
| **Impressions** | `story_view` | A story met the **MRC/IAB viewability standard**: an **image** was on screen for at least **1 continuous second** after it loaded, or a **video** played for at least **2 continuous seconds**. Stories skipped sooner, or that fail to load, aren't counted. Every qualifying showing counts. |
| **Opens** | `group_open` | A story group **started playing** in the viewer: after a tap on its circle, a link to it (shared link, deep link, `open()`), or moving on from the previous group. |
| **Clicks** | `cta_click` | A viewer tapped a story's button (call to action). |
| **Completions** | `group_complete` | A viewer **reached the end** of a group: its last story was shown and they moved past it, either by letting it finish or by tapping on. |
| **Shares** | `share` | A story was shared from the website viewer: the share sheet was sent or the link copied (cancelled share sheets don't count). Apps don't offer sharing yet. |
| **Tap forward** | `tap_forward` | A viewer tapped (or pressed →) to move on to the next story before the current one finished. A story ending by itself doesn't count. |
| **Tap back** | `tap_back` | A viewer tapped (or pressed ←) to go back to the previous story, or to restart the first one. |
| **Skips** | `group_skip` | A viewer swiped (or pressed Shift + → / Page Down) from a story group to the next one without watching the rest of it. |
| **Exits** | `exit` | A viewer closed the viewer before it ran out of stories: close button, swipe down, Escape or a click outside the story. |

Tap forward, Tap back, Skips and Exits count against the **story the viewer was on**, so each
story shows where people moved on or left. They're shown on each story group's Analytics page.

All counts are **activity, not unique people**. Someone who watches a story twice adds two
impressions. Unique people are measured separately, below.

**Circle impressions** (a story group's circle at least 50% on screen for one second, event
`impression`) are still collected by the SDKs but not reported, so they don't feed any number.

## People (reach)

| Metric | Definition |
|---|---|
| **Reach** | The number of unique users who opened a story group and viewed at least one of its stories during the selected period. In line with the MRC/IAB viewability standard, an image story is considered viewed after it has been on screen for at least one continuous second, and a video story after at least two continuous seconds of playback (the same condition as an impression). Each user is counted **once per period**, regardless of how many story groups, stories or sessions they engage with. Users are identified per browser or app installation. |

**How people are counted.** The SDK creates a random **anonymous viewer ID** the first time it runs
on a browser or app install, and keeps it in storage:
- **Where it's kept:** `localStorage` on the web, AsyncStorage in apps.
- **What it is:** a random value with no link to who the person is. It is replaced after **13
  months**, the usual limit for audience-measurement identifiers.
- **How it's sent:** with each analytics batch.
- **What the server stores:** only an HMAC-SHA256 of it, keyed with the server secret and the app ID.
  The device's ID itself is never stored, and the same device gives an unrelated value in each app.
- **How it's stored:** one row per person, app, day, group and kind (`daily_viewers`). Reach uses
  the story-impression rows.

Reach for a period is a distinct count of users, not a sum of daily or per-group figures:
- **Multiple groups:** a user who opens one story group, closes it and then opens another is counted
  once.
- **Return visits:** a user who returns on several days within the period is counted once.

For the same reason, daily reach values and per-group viewer counts do not add up to the period's
total reach.

**Story reach** (the "Top stories by reach" ranking) is the same measure for a single story: unique
people with at least one impression of that story in the period (`daily_story_viewers`, same hashed
ID). Someone who views a story several times counts once. It's recorded from 2026-10-17 onwards.

**Exclusions.** These do not count towards reach:
- story groups closed before any story was displayed;
- stories that failed to load;
- circle impressions without a story impression.

**Limits (true of every ID-based reach measure):**
- Someone who uses two devices or browsers, or clears their site data, counts as two people.
- "All apps & websites" adds each app's reach together, because the same person can't be recognised
  across apps.
- People with reach turned off (no consent, no storage, or apps without AsyncStorage) are left out
  of reach but still included in the counts.
- Reach starts from the day this was deployed. There's no history before 2026-10-15.

**Privacy and consent.** Under the EU/UK ePrivacy rules (and GDPR), storing an analytics identifier on
someone's device can require their consent. Whether it does depends on where your audience is and on
your consent setup. Both SDKs can leave reach out until consent is given:
- **Web:** `Stories.init({ token, reach: false })`, then `client.setReach(true)` after consent.
- **React Native:** `<StoriesBar reach={consented} … />`.

Turning reach off also deletes the stored ID. The counts and rates still work without it.

## Audience (active users, page views, sessions)

These cover website traffic and app users where the SDK is loaded, not only people who see the
story bar. They give the story metrics their context.

| Metric | Definition |
|---|---|
| **Active users** (apps only) | The number of unique users who used your **iOS or Android app** during the selected period, where the app starts the Stories SDK. Each user counts once per period, identified per app installation. **Website visitors are not included**: website traffic is measured by page views. With a 30-day period this corresponds to the app's **monthly active users (MAU)**. |
| **Page views** (web) | Each load of a page where the SDK runs, as Google Analytics counts page views. Single-page sites record route changes with `trackPageView()`. Split into **desktop** and **mobile web**; tablets count as mobile web. |
| **Website visitors** (web) | The number of unique visitors who loaded a page of your **website** where the Stories SDK runs, during the selected period. Each visitor counts once per period, identified per browser. Split into **desktop** and **mobile web**; tablets count as mobile web. App users aren't included; they're active users. |
| **Website story reach rate** (rate, web) | Visitors reached ÷ Website visitors × 100: the share of website visitors who opened a story group and **viewed at least one story** (image 1 s on screen, video 2 s of playback, MRC/IAB) in the period. Both sides are unique website visitors in the same period, so it never exceeds 100%. |
| **App story reach rate** (rate, apps) | App users reached ÷ Active users × 100: the share of app active users who opened a story group and **viewed at least one story** (image 1 s on screen, video 2 s of playback, MRC/IAB) in the period. Both sides are unique app users in the same period, so it never exceeds 100%. Website viewers aren't included, since active users are app-only. A low rate suggests the story bar is placed where many users don't find it. |
| **App sessions** (apps; collected, not shown on the dashboard for now) | A session starts when the app opens, and again when it returns to the foreground after **at least 30 minutes** in the background (the Firebase Analytics rule). Split into **iOS** and **Android**. |

**Limits:**
- **Only where the SDK is loaded.** Sites must load the SDK on every page (`init` without `mount` is
  enough), and apps must start it at launch (`startStories()`). Pages or screens without the SDK
  aren't counted.
- **People, as with reach,** are counted per browser or app install. Active users and website
  visitors rely on the same anonymous ID, so people with reach turned off (for example, without
  consent) count in page views and sessions but not in active users or website visitors.
- **Platform.** Desktop and mobile web come from the browser's own hints (`userAgentData.mobile`)
  or user agent. iPads that report a desktop browser are detected by touch support.
- **No history.** These are recorded from 2026-10-16.

**How they're measured.**
- **Batches:** each SDK batch carries its platform. Page views (`page_view`) and app sessions
  (`app_open`) are events without a story group, counted per app, day and platform
  (`daily_activity`).
- **Active users and website visitors:** every batch with an anonymous viewer ID and a platform
  marks that person for the app, day and platform (`daily_users`). Active users count the iOS and
  Android rows, website visitors the desktop and mobile web rows; both are distinct counts for the
  period. Older SDKs that don't send a platform aren't counted in either.

## Bot filtering (invalid traffic)

Every number above excludes **General Invalid Traffic (GIVT)**, as defined by the MRC's Invalid
Traffic Detection and Filtration Guidelines. The server checks each analytics batch before storing
anything, and drops it if any of these apply:

| Reason | Rule |
|---|---|
| **Bot user agent** | The browser identifies as a known bot, crawler or HTTP library (Googlebot, Bingbot, GPTBot, headless Chrome, curl…), using the open-source [isbot](https://github.com/omrilotan/isbot) list. |
| **Automated browser** | The web SDK found `navigator.webdriver` set (Selenium, Puppeteer, Playwright and similar tools). |
| **No user agent** | A browser request without a user agent; real browsers always send one. |

**What's kept:** only the number of excluded events per app, day and reason (`daily_filtered`), for
disclosure; the dashboard shows it under Audience. Filtered batches get the same response as any
other, so bots can't tell they were filtered.

**App traffic** isn't checked by user agent, because the app SDKs' HTTP clients (e.g. okhttp on
Android) are on bot lists. Apps are identified by the React Native SDK version in each batch.

**Not covered:** Sophisticated Invalid Traffic (SIVT): bots that pretend to be real browsers, data
centre and proxy traffic, and click fraud. Detecting it needs IP reputation data and behaviour
analysis. The IAB/ABC International Spiders & Bots List, a paid list, can replace or extend isbot
for accredited measurement.

**Tests:** `apps/api/test/sdk.test.ts` ("bot filtering") checks each reason, the disclosure counts,
and that app traffic isn't mistaken for bots.

## Rates

Rates are always worked out from the **totals for the whole period** (sum of the top ÷ sum of the
bottom), never by averaging daily or per-group rates. A rate with nothing to divide by shows "–".
They're capped at 100%.

| Rate | Formula | What it tells you |
|---|---|---|
| **Engagement rate** (headline) | (Clicks + Shares) ÷ Impressions × 100 | How often a story impression led someone to act on the story. |
| **Completion rate** | Completions ÷ Opens × 100 | How often a group that started playing was watched to its last story. |
| **Click-through rate** | Clicks ÷ Impressions × 100 | How often a story impression led to a button tap. |
| **Share rate** | Shares ÷ Impressions × 100 | How often a story impression was shared. |

**Rankings.** "Top" lists (top groups, top stories) are ranked by the **count** (clicks, views,
impressions), never by a rate. On small numbers a rate misleads: a story with 1 view and 1 click
has a 100% click-through rate, and would beat a story with 60 clicks from 549 impressions. The rate is
shown beside the count as context. The one ranking by rate, **Top stories by click rate** on Home,
only includes stories with at least **100 impressions** (and at least one click), and says so.

The **Analytics** page's tables can be sorted by any column, including rates where they appear. There, a rate worked
out from fewer than **100** impressions (or opens, for completion rate) is greyed out and always
sorted after the rows that have enough, so a small base can't top the list.

**What counts as an interaction for engagement:**
- **Counted:** intentional actions on a story's content, which today are button taps and shares. New interactive features (polls, replies, quizzes) should be added to its numerator when they arrive.
- **Not counted:** moving between stories (taps, swipes) and opening a group. Opens have their own rate, so engagement measures what happens once people are watching.

Engagement rate is therefore Click-through rate + Share rate.

## How the SDKs measure each event

Both SDKs share the viewer state machine and event rules in `packages/core` (`machine.ts`,
`analytics.ts`), so they count the same way.

| Event | Web SDK | React Native SDK |
|---|---|---|
| `impression` | `IntersectionObserver`: a 1-second timer starts when ≥ 50% of the circle is visible; it is cancelled if the circle scrolls away, or the tab is hidden, before then. One per group per page view. | Visible items are computed from the bar's scroll position and width; the same 1-second timer, paused while the app is in the background or the viewer covers the bar. One per group per bar mount. |
| `group_open` | When the viewer opens on a group or moves to another group. | Same. |
| `story_view` | Timing starts once the image has loaded and decoded, or the video has started playing. **Image:** 1 continuous second on screen; holding to pause doesn't stop it, since the image stays visible. **Video:** 2 continuous seconds of playback; pausing or buffering restarts the count. A hidden tab or open share sheet restarts both. | Timing starts at the image's `onLoad`, or when the video is ready for display. The same 1 s / 2 s rules apply, and going to the background restarts the count. |
| `cta_click` | Tap on the story button (before navigation). | Same. |
| `group_complete` | Moving forward past a group's last story, if that story was shown. | Same. |
| `share` | After `navigator.share()` resolves, or the link was copied. | Not available. |
| `tap_forward` / `tap_back` | A tap on the right 70% / left 30% of the story, or the → / ← keys. A video finishing doesn't count. | The same tap zones, and the screen-reader next / previous actions. |
| `group_skip` | A swipe left, Shift + →, or Page Down. | A swipe left. |
| `exit` | Close button, swipe down, Escape, or a click outside the story. Not when the page removes the viewer. | Close button or swipe down. |

**Reach:** each batch carries the device's anonymous viewer ID (`viewer`) when reach is on. For
every circle impression and story view, the server records the hashed viewer for that app, day,
group and kind. Repeat events only increase that row's view count.

**Sending:**
- Events are batched and sent every 5 seconds.
- **Web:** also flushed with `sendBeacon` when the page is hidden.
- **Apps:** also flushed when the app goes to the background.
- **Server:** the API drops events for groups or stories that don't belong to the token's app, and stores daily counts per app, group and story (`event_counts_daily`).

**Tests that pin these rules:**
- `packages/core/test/machine.test.ts` (viewability):
  - images need 1 continuous second and keep counting while held;
  - videos need 2 continuous seconds of playback, and pausing or buffering restarts the count;
  - going off screen restarts the count;
  - a story that ends exactly as it qualifies is still counted.
- `packages/core/test/support.test.ts`:
  - stories skipped within the viewable time, or that failed to load, aren't views;
  - buffering doesn't double count;
  - completions need the last story shown.
- `packages/web/test/sdk.test.ts`: impressions need a full second, and an unloaded story isn't a view.
- `packages/contracts/src/metrics.test.ts`: the rate formulas.
- `packages/core/test/support.test.ts` (anonymous viewer ID): the ID is made once, kept, replaced
  after 13 months and forgotten on request.
- `apps/api/test/sdk.test.ts` (reach): each person counts once, the ID is never stored as-is, and
  someone active on several days counts once in the period.

## Industry definitions we follow

There's no single official engagement-rate formula for stories. These are the published conventions
our definitions follow:

- **Viewable impression (MRC/IAB):** for display, an impression is viewable when at least 50% of its
  pixels are on screen for one continuous second. For video, it's two continuous seconds of playback,
  which needn't be the first two. The mobile guidelines use the same thresholds, and timing starts
  only once the content has loaded and rendered. We apply this to story impressions (images 1 s,
  videos 2 s of playback). Stories are full screen, so the 50% pixel
  condition is always met while the viewer is open.
  [MRC mobile guidelines (Research Live)](https://www.mrweb.com/drno/news22862.htm) ·
  [MRC video viewability (ClickZ)](https://clickz.com/?p=30769)
  [MRC Viewable Ad Impression Measurement Guidelines](https://www.iab.com/wp-content/uploads/2015/06/MRC-Viewable-Ad-Impression-Measurement-Guideline.pdf)
- **Engagement rate:** the common formula is interactions ÷ impressions (or ÷ reach) × 100. For
  Stories, interactions are actions on the story such as link clicks, shares, replies and sticker
  taps. Navigation taps aren't interactions.
  [SocialBu: Instagram engagement rate](https://socialbu.com/blog/?p=10613) ·
  [StoryChief metrics](https://help.storychief.io/articles/483645-understanding-metrics-in-storychief) ·
  [Instagram Story reach calculator](https://www.calcplanet.com/social-media/instagram-story-reach-calculator/)
- **Click-through rate:** CTA clicks ÷ impressions.
  [WSC Sports metric specifications](https://dev.wsc-sports.com/docs/analytics-metric-specifications-and-availability)
- **Completion rate:** viewers who reached the last frame ÷ viewers who started.
  [Socialkit: story completion rate](https://socialk.it/en/glossary/story-completion-rate) ·
  [Iconosquare: completion rate](https://support.iconosquare.com/how-is-the-completion-rate-calculated)
- **Impressions vs reach:** impressions count every view, while reach counts unique people.
  [Instagram Platform insights](https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights)

## Changes

- **2026-10-19:** Average daily reach removed; Reach already gives the unique people for stories
  and groups.

- **2026-10-18:** the Apps & websites table was removed from Analytics, along with the per-app
  breakdown the overview API returned for it. Pick an app or website in the page's menu to see
  its numbers on their own.

- **2026-10-18:** new counts **Tap forward**, **Tap back**, **Skips** and **Exits**. Counted from this date, and only from SDK builds that include them.
  The Analytics page's Story groups table now shows Reach, Impressions, Clicks, Skips, Opens,
  Shares and Completions. Clicking a group opens its own page, with every group-level number and
  a table of its stories; the stories table moved there from the main page.

- **2026-10-18:** Analytics has its own page (sidebar, after Team), replacing each app's
  Analytics tab. It shows every count and rate with its change on the previous period (rates in
  percentage points), the audience, a daily chart of any metric, side-by-side apps & websites,
  sortable story group and story tables, bot filtering by reason, and CSV export.

- **2026-10-18:** Website visitors and Website story reach rate added (Audience), the website
  counterparts of Active users and the app's Story reach rate, which is now labelled "App story
  reach rate". Website visitors are counted from this date; earlier visits aren't included.

- **2026-10-18:** the Home gallery is now "Top stories by click rate": ranked by click-through
  rate among stories with at least 100 impressions.

- **2026-10-17:** story reach added: unique people per story, shown in "Top stories by reach"
  next to "Top stories by impressions". No history before this date.

- **2026-10-16:** App sessions hidden from the dashboard (still collected). Active users show their
  iOS / Android split.

- **2026-10-16:** Story reach rate added (Audience): the share of app active users who viewed at
  least one story.

- **2026-10-16:** "Impressions" now means **story impressions** under the MRC/IAB standard (images
  1 s on screen, videos 2 s of playback), replacing the separate "Story views". Circle impressions,
  and the metrics built on them (Open rate, Saw the bar, Bar exposure), are no longer reported.
  Views per viewer was removed.

- **2026-10-16:** Active users and Bar exposure are app-only (iOS and Android). Website visitors are
  no longer recorded as active users; website traffic is measured by page views.

- **2026-10-16:** bot filtering (General Invalid Traffic) added. Bots, crawlers, automated browsers
  and browser requests without a user agent are excluded, and the excluded count is shown. Earlier
  data wasn't filtered, which includes headless browser test runs.

- **2026-10-16:** Audience added (Active users, Page views split desktop / mobile web, App sessions
  split iOS / Android, Bar exposure). The web SDK records a page view when it starts; the React
  Native SDK records sessions with the 30-minute rule and adds `startStories()`.

- **2026-10-16:** story views follow the full MRC/IAB viewability standard: images need 1 continuous
  second on screen and videos 2 continuous seconds of playback (before, a story counted as soon as it
  appeared). Reach, Engagement rate, Click-through and Share rates use story views, so they follow
  too. Video stories shorter than 2 seconds can't meet the video standard, so they're never counted
  as viewed.

- **2026-10-15:** reach added (Reach, Views per viewer, Saw the bar). It counts unique people with
  the SDKs' anonymous viewer ID. History starts from this date.

- **2026-10-15:** the counting rules were tightened to the definitions above:
  - impressions now need one continuous second on screen (before, they counted as soon as half the circle appeared);
  - story views now need the story to have appeared (before, they counted on navigation, including stories skipped while loading or that failed);
  - completions now need the last story to have been shown.

  Activity recorded before this date was counted the old way, so impressions and views before it
  may be slightly higher than they would be now.
