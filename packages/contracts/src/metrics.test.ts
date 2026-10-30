import { describe, expect, it } from 'vitest';
import { eventTypes } from './analytics';
import {
  AUDIENCE_DEFINITIONS,
  type EventCountsLike,
  METRIC_DEFINITIONS,
  RATE_DEFINITIONS,
  REACH_DEFINITIONS,
  rateValue,
} from './metrics';

const counts = (c: Partial<EventCountsLike>): EventCountsLike => ({
  impression: 0,
  group_open: 0,
  story_view: 0,
  cta_click: 0,
  group_complete: 0,
  share: 0,
  tap_forward: 0,
  tap_back: 0,
  group_skip: 0,
  exit: 0,
  ...c,
});

describe('metric definitions', () => {
  it('defines every reported event (circle impressions are collected, not reported)', () => {
    expect(METRIC_DEFINITIONS.map((m) => m.key).sort()).toEqual(
      eventTypes.filter((t) => t !== 'impression').sort(),
    );
    expect(METRIC_DEFINITIONS.find((m) => m.key === 'story_view')?.label).toBe('Impressions');
  });

  it('works out engagement as clicks plus shares per story view', () => {
    const c = counts({ story_view: 1488, cta_click: 66, share: 1 });
    expect(rateValue(c, RATE_DEFINITIONS.engagement)).toBeCloseTo(67 / 1488);
    expect(rateValue(c, RATE_DEFINITIONS.click)).toBeCloseTo(66 / 1488);
    expect(rateValue(c, RATE_DEFINITIONS.share)).toBeCloseTo(1 / 1488);
  });

  it('works out the completion rate from opens', () => {
    const c = counts({ group_open: 751, group_complete: 365 });
    expect(rateValue(c, RATE_DEFINITIONS.completion)).toBeCloseTo(365 / 751);
  });

  it('has no rate without a base, and never more than 100%', () => {
    expect(rateValue(counts({ cta_click: 3 }), RATE_DEFINITIONS.click)).toBeNull();
    expect(
      rateValue(counts({ group_open: 1, group_complete: 4 }), RATE_DEFINITIONS.completion),
    ).toBe(1);
  });
});

describe('short definitions', () => {
  it('exist for every metric and stay short', () => {
    const all = [
      ...METRIC_DEFINITIONS,
      ...Object.values(RATE_DEFINITIONS),
      ...Object.values(REACH_DEFINITIONS),
      ...Object.values(AUDIENCE_DEFINITIONS),
    ];
    for (const m of all) {
      expect(m.summary.length, m.label).toBeGreaterThan(10);
      expect(m.summary.split(/\s+/).length, m.label).toBeLessThanOrEqual(16);
    }
  });
});
