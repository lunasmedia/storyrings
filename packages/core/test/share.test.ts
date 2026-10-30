import { describe, expect, it } from 'vitest';
import { appShareUrl, parseShareLink, shareUrl, withoutShareLink } from '../src';

const G = '3f6c1e2a-0000-4000-8000-000000000001';
const S = '3f6c1e2a-0000-4000-8000-000000000002';

describe('shared story links', () => {
  it('builds a link to a story on the current page and reads it back', () => {
    const url = shareUrl('https://news.example.com/world/article?ref=home', {
      groupId: G,
      storyId: S,
    });
    expect(url).toBe(`https://news.example.com/world/article?ref=home#stories=${G}/${S}`);
    expect(parseShareLink(url)).toEqual({ groupId: G, storyId: S });
  });

  it('replaces any existing fragment and supports group-only links', () => {
    const url = shareUrl('https://x.example/page#section-2', { groupId: G });
    expect(url).toBe(`https://x.example/page#stories=${G}`);
    expect(parseShareLink(url)).toEqual({ groupId: G });
  });

  it('escapes ids so a link can never smuggle in other fragment parts', () => {
    const url = shareUrl('https://x.example/', { groupId: 'a/b', storyId: 'c d' });
    expect(parseShareLink(url)).toEqual({ groupId: 'a/b', storyId: 'c d' });
  });

  it('ignores URLs that are not shared story links', () => {
    for (const u of [
      'https://x.example/',
      'https://x.example/#section',
      'https://x.example/#stories=',
      `https://x.example/#stories=${G}/${S}/extra`,
      'https://x.example/#stories=%E0%A4%A',
      'not a url',
    ]) {
      expect(parseShareLink(u)).toBeNull();
    }
  });

  it('removes only the shared-story fragment', () => {
    expect(withoutShareLink(`https://x.example/a?b=1#stories=${G}/${S}`)).toBe(
      'https://x.example/a?b=1',
    );
    expect(withoutShareLink('https://x.example/a#section')).toBe('https://x.example/a#section');
  });
});

describe('appShareUrl', () => {
  it('fills a mobile app’s share link template, encoded', () => {
    expect(
      appShareUrl('https://news.example.com/stories/{group}/{story}', {
        groupId: 'g 1',
        storyId: 's/2',
      }),
    ).toBe('https://news.example.com/stories/g%201/s%2F2');
    expect(
      appShareUrl('https://x.example/s?id={story}&g={group}&again={story}', {
        groupId: 'g',
        storyId: 's',
      }),
    ).toBe('https://x.example/s?id=s&g=g&again=s');
  });
});
