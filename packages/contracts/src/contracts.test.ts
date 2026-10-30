import { describe, expect, it } from 'vitest';
import {
  createAppInput,
  describeTagFilter,
  isAllowedCtaUrl,
  matchesTagFilter,
  normalizeTags,
  tagFilterInput,
} from './index';

describe('isAllowedCtaUrl', () => {
  it.each([
    ['https://example.com/a?b=1', [], true],
    ['http://example.com', [], true],
    ['myshop://product/1', ['myshop'], true],
    ['MYSHOP://product/1', ['myshop'], true],
    ['myshop://product/1', [], false],
    ['javascript:alert(1)', ['javascript'], false],
    ['data:text/html,hi', [], false],
    ['vbscript:x', [], false],
    ['/relative/path', [], false],
    ['', [], false],
    ['https://', [], false],
    [' javascript:alert(1)', [], false],
    ['java\tscript:alert(1)', [], false],
    ['myshop:', ['myshop'], false],
  ])('%s with %j → %s', (url, schemes, expected) => {
    expect(isAllowedCtaUrl(url, schemes)).toBe(expected);
  });
});

describe('createAppInput', () => {
  it('normalises website URLs to origins and lowercases schemes', () => {
    const parsed = createAppInput.parse({
      kind: 'web',
      name: 'Shop',
      url: 'https://Shop.Example.com/path?q=1',
      deepLinkSchemes: ['MyShop'],
    });
    expect(parsed).toMatchObject({ url: 'https://shop.example.com', deepLinkSchemes: ['myshop'] });
  });

  it('rejects http/https as deep-link schemes', () => {
    const res = createAppInput.safeParse({
      kind: 'mobile',
      name: 'App',
      bundleIds: ['com.example.app'],
      deepLinkSchemes: ['https'],
    });
    expect(res.success).toBe(false);
  });
});

describe('user tags and tag filters', () => {
  it('normalises tags: lowercase, trimmed, unique, sorted, invalid ones dropped', () => {
    expect(normalizeTags([' London', 'premium', 'london', 'a b', 'x@y.com', 'city:leeds'])).toEqual(
      ['city:leeds', 'london', 'premium'],
    );
    expect(normalizeTags('london,,PREMIUM')).toEqual(['london', 'premium']);
    expect(normalizeTags(undefined)).toEqual([]);
    expect(normalizeTags(Array.from({ length: 80 }, (_, i) => `t${i}`))).toHaveLength(50);
  });

  it('validates a group’s tag filter: valid tags only, empty conditions dropped', () => {
    expect(
      tagFilterInput.parse([
        { mode: 'include', tags: ['London', 'london'] },
        { mode: 'exclude', tags: [] },
      ]),
    ).toEqual([{ mode: 'include', tags: ['london'] }]);
    expect(
      tagFilterInput.safeParse([{ mode: 'include', tags: ['someone@example.com'] }]).success,
    ).toBe(false);
  });

  it('passes a tag filter only when every condition passes', () => {
    const filter = [
      { mode: 'include' as const, tags: ['london', 'leeds'] },
      { mode: 'exclude' as const, tags: ['churned'] },
    ];
    const has = (...tags: string[]) => matchesTagFilter(filter, new Set(tags));
    expect(has('leeds')).toBe(true);
    expect(has('york')).toBe(false);
    expect(has('london', 'churned')).toBe(false);
    expect(matchesTagFilter([], new Set())).toBe(true);
    expect(matchesTagFilter(null, new Set())).toBe(true);
    expect(describeTagFilter(filter)).toBe('london or leeds, not churned');
  });
});
