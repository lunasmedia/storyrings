/**
 * What every analytics number means, in one place: the dashboard shows these
 * definitions, and docs/metrics.md explains how the SDKs measure them and which
 * industry definitions they follow. Change the wording here, not in the UI.
 */
import type { EventType } from './sdk-types';

export type EventCountsLike = Record<EventType, number>;

export interface MetricDefinition {
  key: EventType;
  label: string;
  /** Full definition (the "How these are measured" list and docs). */
  definition: string;
  /** One short, plain sentence for the info button next to the metric. */
  summary: string;
}

/**
 * Reported counts. Circle impressions (`impression`) are still collected by the SDKs but
 * not reported; "Impressions" are story impressions (`story_view`, MRC/IAB viewability).
 */
export const METRIC_DEFINITIONS: readonly MetricDefinition[] = [
  {
    key: 'group_open',
    label: 'Opens',
    summary: 'Times a story group started playing, from a tap, a link or the previous group.',
    definition:
      'A story group started playing in the viewer: after a tap on its circle, a link to it, or moving on from the previous group.',
  },
  {
    key: 'story_view',
    label: 'Impressions',
    summary: 'Times a story was viewed: images after 1 second, videos after 2 seconds of playback.',
    definition:
      'A story met the MRC/IAB viewability standard: an image was on screen for at least one continuous second after it loaded, or a video played for at least two continuous seconds. Stories skipped sooner, or that fail to load, don’t count. Every qualifying showing counts (impressions, not unique viewers).',
  },
  {
    key: 'cta_click',
    label: 'Clicks',
    summary: 'Taps on a story’s button.',
    definition: 'A viewer tapped a story’s button (its call to action).',
  },
  {
    key: 'group_complete',
    label: 'Completions',
    summary: 'Times a story group was watched through to its last story.',
    definition:
      'A viewer reached the end of a story group: its last story was shown and they moved past it, by letting it finish or tapping on.',
  },
  {
    key: 'share',
    label: 'Shares',
    summary: 'Times a story was shared from the website.',
    definition:
      'A story was shared from the website viewer: the share sheet was sent or the link was copied.',
  },
  {
    key: 'tap_forward',
    label: 'Tap forward',
    summary: 'Taps to move on to the next story before this one finished.',
    definition:
      'A viewer tapped (or pressed the right arrow key) to move on to the next story before the current one finished playing. Stories that end on their own don’t count.',
  },
  {
    key: 'tap_back',
    label: 'Tap back',
    summary: 'Taps to go back to the previous story.',
    definition:
      'A viewer tapped (or pressed the left arrow key) to go back to the previous story, or to restart the first one.',
  },
  {
    key: 'group_skip',
    label: 'Skips',
    summary: 'Times a viewer swiped past a story group to the next one.',
    definition:
      'A viewer swiped (or used Shift + right arrow or Page Down) to jump from a story group to the next one without watching the rest of it. Counted against the story they left from.',
  },
  {
    key: 'exit',
    label: 'Exits',
    summary: 'Times a viewer closed the stories viewer.',
    definition:
      'A viewer closed the stories viewer before it ran out of stories: with the close button, a swipe down, the Escape key or a click outside the story. Counted against the story they were on.',
  },
];

export interface RateDefinition {
  key: string;
  label: string;
  /** Short label for compact places (rings). */
  short: string;
  definition: string;
  /** How it's calculated, for display. */
  formula: string;
  /** One short, plain sentence for the info button next to the metric. */
  summary: string;
  /** Events added up for the top of the fraction. */
  numerator: readonly EventType[];
  denominator: EventType;
}

/**
 * Unique people, counted with an anonymous ID the SDK keeps on each browser or app
 * install (see docs/metrics.md for how, and its limits).
 */
export const REACH_DEFINITIONS = {
  viewers: {
    key: 'viewers',
    label: 'Reach',
    summary: 'Unique people who viewed at least one story. Each person counts once per period.',
    definition:
      'The number of unique users who opened a story group and viewed at least one of its stories during the selected period. In line with the MRC/IAB viewability standard, an image story is considered viewed after it has been on screen for at least one continuous second, and a video story after at least two continuous seconds of playback. Each user is counted once per period, regardless of how many story groups, stories or sessions they engage with. Users are identified per browser or app installation.',
  },
} as const;

/**
 * Traffic and active users wherever the SDK runs, including pages and screens without a
 * story bar (when the site or app loads the SDK there).
 */
export const AUDIENCE_DEFINITIONS = {
  activeUsers: {
    key: 'activeUsers',
    label: 'Active users',
    summary: 'Unique people who used your iOS or Android app. Each counts once per period.',
    definition:
      'The number of unique users who used your iOS or Android app during the selected period, where the app starts the Stories SDK. Each user is counted once per period and identified per app installation. Website visitors are not included; website traffic is measured by page views. With a 30-day period this corresponds to the app’s monthly active users (MAU).',
  },
  pageViews: {
    key: 'pageViews',
    label: 'Page views',
    summary: 'Page loads on your website, split into desktop and mobile web.',
    definition:
      'Each load of a web page where the Stories SDK runs, as Google Analytics counts page views. Single-page sites record route changes with trackPageView(). Split into desktop and mobile web; tablets count as mobile web.',
  },
  visitors: {
    key: 'visitors',
    label: 'Website visitors',
    summary: 'Unique people who visited your website. Each counts once per period.',
    definition:
      'The number of unique visitors who loaded a page of your website where the Stories SDK runs, during the selected period. Each visitor is counted once per period and identified per browser. Split into desktop and mobile web; tablets count as mobile web. App users are not included; they are counted as active users.',
  },
  webStoryReachRate: {
    key: 'webStoryReachRate',
    label: 'Website story reach rate',
    summary: 'Share of website visitors who opened and viewed at least one story.',
    formula: 'Visitors reached ÷ Website visitors × 100',
    definition:
      'The share of website visitors who opened a story group and viewed at least one of its stories during the selected period: an image on screen for 1 continuous second, or a video played for 2 continuous seconds (MRC/IAB). Both sides count unique website visitors in the same period, so it never exceeds 100%. A low rate suggests the story bar is placed where many visitors don’t find it.',
  },
  storyReachRate: {
    key: 'storyReachRate',
    label: 'App story reach rate',
    summary: 'Share of app active users who opened and viewed at least one story.',
    formula: 'App users reached ÷ Active users × 100',
    definition:
      'The share of app active users who opened a story group and viewed at least one of its stories during the selected period: an image on screen for 1 continuous second, or a video played for 2 continuous seconds (MRC/IAB). Both sides count unique app users (iOS and Android) in the same period, so it never exceeds 100%. A low rate suggests the story bar is placed where many users don’t find it.',
  },
  sessions: {
    key: 'sessions',
    label: 'App sessions',
    summary: 'App opens, plus returns after 30+ minutes away, on iOS and Android.',
    definition:
      'A session starts when the app is opened, and again when it returns to the foreground after at least 30 minutes in the background (the Firebase Analytics rule). Split into iOS and Android.',
  },
} as const;

/** Bot filtering, disclosed as MRC guidelines require. */
export const INVALID_TRAFFIC = {
  label: 'Bot filtering',
  summary: 'Bots, crawlers and automated browsers are excluded from every number.',
  definition:
    'General Invalid Traffic (MRC) is excluded from all metrics: known bots, crawlers and HTTP libraries (by user agent, using the open-source isbot list), automated browsers such as Selenium, Puppeteer and Playwright (navigator.webdriver), and browser requests without a user agent. The number of excluded events is shown for transparency.',
} as const;

/** Ratios of the counts above, always worked out from period totals (not averaged). */
export const RATE_DEFINITIONS = {
  engagement: {
    key: 'engagement',
    label: 'Engagement rate',
    summary: 'How often a story impression led to a button tap or a share.',
    short: 'Engagement rate',
    definition:
      'How often a story impression led someone to act on the story. Interactions are taps on a story’s button and shares; moving between stories and opening groups aren’t interactions.',
    formula: '(Clicks + Shares) ÷ Impressions × 100',
    numerator: ['cta_click', 'share'],
    denominator: 'story_view',
  },
  completion: {
    key: 'completion',
    label: 'Completion rate',
    summary: 'How often a story group that started was watched to the end.',
    short: 'Completion rate',
    definition: 'How often a story group that started playing was watched to its last story.',
    formula: 'Completions ÷ Opens × 100',
    numerator: ['group_complete'],
    denominator: 'group_open',
  },
  click: {
    key: 'click',
    label: 'Click-through rate',
    summary: 'How often a story impression led to a button tap.',
    short: 'Click-through rate',
    definition: 'How often a story impression led to a tap on the story’s button.',
    formula: 'Clicks ÷ Impressions × 100',
    numerator: ['cta_click'],
    denominator: 'story_view',
  },
  share: {
    key: 'share',
    label: 'Share rate',
    summary: 'How often a story impression was shared.',
    short: 'Share rate',
    definition: 'How often a story impression was shared.',
    formula: 'Shares ÷ Impressions × 100',
    numerator: ['share'],
    denominator: 'story_view',
  },
} as const satisfies Record<string, RateDefinition>;

export type RateKey = keyof typeof RATE_DEFINITIONS;

/** A rate as a fraction (0..1, capped), or null when there's nothing to divide by. */
export function rateValue(counts: EventCountsLike, rate: RateDefinition): number | null {
  const den = counts[rate.denominator];
  if (!den) return null;
  const num = rate.numerator.reduce((sum, k) => sum + counts[k], 0);
  return Math.min(1, num / den);
}
