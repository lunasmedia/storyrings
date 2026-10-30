import {
  type AppearanceOverrides,
  formatCountdown,
  resolveAppearance,
} from '@stories/contracts/appearance';
import type { FeedGroupDto } from '@stories/core';
import { resolveTheme } from '@stories/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  badgeSpeech,
  type CircleState,
  circleVars,
  renderCircle,
  themeAppearance,
} from '../src/circle.js';
import { createBarPreview, init } from '../src/index.js';

const base: FeedGroupDto = {
  id: 'g1',
  title: 'Summer sale',
  coverUrl: 'https://cdn.test/still.jpg',
  updatedAt: '',
  stories: [
    {
      id: 's1',
      type: 'image',
      url: 'https://cdn.test/s.png',
      durationMs: 5000,
      width: 1,
      height: 1,
      alt: '',
      cta: null,
    },
  ],
};
const look = (o: AppearanceOverrides = {}) => resolveAppearance(o);
const state: CircleState = { seen: false, reducedMotion: false, lowData: false };
const circle = (
  o: AppearanceOverrides = {},
  s: Partial<CircleState> = {},
  g: Partial<FeedGroupDto> = {},
) => renderCircle({ ...base, ...g }, look(o), { ...state, ...s });
const varOf = (el: HTMLElement, name: string) =>
  new RegExp(`${name}:([^;]+)`).exec(el.getAttribute('style') ?? '')?.[1];

describe('ring styles', () => {
  it('gradient uses the colours and angle', () => {
    const el = circle({
      ring: { style: 'gradient', colors: ['#111111', '#222222', '#333333'], angle: 90 },
    });
    expect(varOf(el, '--c-ring')).toBe('linear-gradient(90deg, #111111, #222222, #333333)');
    expect(varOf(el, '--c-conic')).toBe('conic-gradient(#111111, #222222, #333333, #111111)');
  });

  it('solid uses one colour', () => {
    expect(varOf(circle({ ring: { style: 'solid', colors: ['#e8175d'] } }), '--c-ring')).toBe(
      '#e8175d',
    );
  });

  it('none removes the ring (width 0) and its animation', () => {
    const el = circle({ ring: { style: 'none', animation: 'pulse' } });
    expect(el.classList.contains('no-ring')).toBe(true);
    expect(varOf(el, '--c-ring-w')).toBe('0px');
    expect(el.className).not.toContain('anim-');
  });

  it('applies thickness, gap and gap colour', () => {
    const el = circle({ ring: { width: 5, gap: 4, gapColor: '#000000' } });
    expect([varOf(el, '--c-ring-w'), varOf(el, '--c-gap'), varOf(el, '--c-gap-color')]).toEqual([
      '5px',
      '4px',
      '#000000',
    ]);
    expect(varOf(circle({ ring: { gapColor: 'transparent' } }), '--c-gap-color')).toBe(
      'transparent',
    );
    expect(varOf(circle(), '--c-gap-color')).toBe('var(--stories-ring-gap-color, Canvas)');
  });

  it.each(['rotate', 'pulse', 'shimmer'] as const)(
    '%s animation adds its class and speed',
    (animation) => {
      const el = circle({ ring: { animation, speed: 'fast' } });
      expect(el.classList.contains(`anim-${animation}`)).toBe(true);
      expect(varOf(el, '--c-speed')).toBe('1.2s');
    },
  );
});

describe('shimmer band', () => {
  it('is added (clipped to the ring) only while animating', () => {
    expect(
      circle({ ring: { animation: 'shimmer' } }).querySelector('.ring > .shine'),
    ).not.toBeNull();
    expect(
      circle({ ring: { animation: 'shimmer' } }, { reducedMotion: true }).querySelector('.shine'),
    ).toBeNull();
    expect(circle({ ring: { animation: 'pulse' } }).querySelector('.shine')).toBeNull();
  });
});

describe('seen state', () => {
  it('uses the seen colour and stops animating when "only when unseen"', () => {
    const el = circle(
      { ring: { animation: 'rotate', seenColor: '#aaaaaa', animateOnlyUnseen: true } },
      { seen: true },
    );
    expect(el.classList.contains('seen')).toBe(true);
    expect(varOf(el, '--c-seen')).toBe('#aaaaaa');
    expect(el.className).not.toContain('anim-');
  });

  it('keeps animating seen circles when allowed', () => {
    const el = circle({ ring: { animation: 'rotate', animateOnlyUnseen: false } }, { seen: true });
    expect(el.classList.contains('anim-rotate')).toBe(true);
  });
});

describe('animated covers and reduced motion', () => {
  const animated = {
    cover: {
      image: 'https://cdn.test/poster.jpg',
      video: 'https://cdn.test/loop.mp4',
      animated: true,
    },
  };

  it('plays the looping muted video over the poster', () => {
    const el = circle({}, {}, animated);
    const video = el.querySelector('video')!;
    expect(video.getAttribute('src')).toBe('https://cdn.test/loop.mp4');
    expect(video.muted && video.loop && video.autoplay && video.hasAttribute('playsinline')).toBe(
      true,
    );
    expect(video.getAttribute('poster')).toBe('https://cdn.test/poster.jpg');
    expect(el.querySelector('img')!.getAttribute('src')).toBe('https://cdn.test/poster.jpg');
    // Motion appears only once it actually plays.
    expect(el.querySelector('.img')!.classList.contains('playing')).toBe(false);
    video.dispatchEvent(new Event('playing'));
    expect(el.querySelector('.img')!.classList.contains('playing')).toBe(true);
  });

  it('shows only the poster and no ring animation with reduced motion', () => {
    const el = circle({ ring: { animation: 'shimmer' } }, { reducedMotion: true }, animated);
    expect(el.querySelector('video')).toBeNull();
    expect(el.querySelector('img')!.getAttribute('src')).toBe('https://cdn.test/poster.jpg');
    expect(el.className).not.toContain('anim-');
  });

  it('shows only the poster on Save-Data / slow connections', () => {
    expect(circle({}, { lowData: true }, animated).querySelector('video')).toBeNull();
  });

  it('falls back to coverUrl for servers without renditions', () => {
    expect(circle().querySelector('img')!.getAttribute('src')).toBe('https://cdn.test/still.jpg');
  });
});

describe('badges', () => {
  it('renders preset, text and emoji badges with colours and position', () => {
    const el = circle({
      badge: {
        type: 'preset',
        text: 'NEW',
        background: '#000000',
        color: '#ffffff',
        position: 'top-right',
      },
    });
    const badge = el.querySelector('.badge')!;
    expect(badge.textContent).toBe('NEW');
    expect(badge.classList.contains('tr')).toBe(true);
    expect([varOf(el, '--c-badge-bg'), varOf(el, '--c-badge-fg')]).toEqual(['#000000', '#ffffff']);
    expect(
      circle({ badge: { type: 'emoji', text: '🔥' } }).querySelector('.badge.bc')!.textContent,
    ).toBe('🔥');
    expect(circle({ badge: { type: 'none', text: 'X' } }).querySelector('.badge')).toBeNull();
  });

  it('counts down to the schedule end and disappears afterwards', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const at = (ms: number) =>
      circle(
        { badge: { type: 'countdown' } },
        { now },
        { endsAt: new Date(now + ms).toISOString() },
      ).querySelector('.badge')?.textContent ?? null;
    expect(at(3 * 86_400_000 + 5)).toBe('3d');
    expect(at(5 * 3_600_000)).toBe('5h');
    expect(at(12 * 60_000)).toBe('12m');
    expect(at(-1000)).toBeNull();
    expect(formatCountdown(30_000)).toBe('1m');
    expect(
      circle({ badge: { type: 'countdown' } }, { now }, { endsAt: null }).querySelector('.badge'),
    ).toBeNull();
  });

  it('is part of the accessible name', () => {
    expect(badgeSpeech(look({ badge: { type: 'preset', text: 'SALE' } }), null)).toBe(', SALE');
    const end = new Date(Date.now() + 2 * 3_600_000 + 60_000).toISOString();
    expect(badgeSpeech(look({ badge: { type: 'countdown' } }), end)).toBe(', ends in 2h');
  });
});

describe('title', () => {
  it('applies colour, weight and max lines, or hides it', () => {
    const el = circle({ title: { color: '#123456', weight: 700, maxLines: 2 } });
    expect([varOf(el, '--c-title'), varOf(el, '--c-weight'), varOf(el, '--c-lines')]).toEqual([
      '#123456',
      '700',
      '2',
    ]);
    expect(el.querySelector('.title')!.textContent).toBe('Summer sale');
    expect(varOf(circle(), '--c-title')).toBe('var(--s-title-color)');
    expect(circle({ title: { hidden: true } }).querySelector('.title')).toBeNull();
  });
});

describe('precedence', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    document.body.innerHTML = '<div id="bar"></div>';
    fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            app: { id: 'a', deepLinkSchemes: [] },
            groups: [
              {
                ...base,
                appearance: look({
                  ring: { style: 'solid', colors: ['#00ff00'] },
                  badge: { type: 'preset', text: 'HOT' },
                }),
              },
            ],
          }),
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('the dashboard appearance wins over ring colours set in code; code keeps the size', async () => {
    const client = init({
      token: 'pk_live_x',
      apiUrl: 'https://api.test',
      analytics: false,
      storage: null,
    });
    const onLoad = vi.fn();
    client.mount('#bar', { onLoad, theme: { ringColors: ['#ff0000'], circleSize: 90 } });
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
    const root = document.querySelector('[data-stories-bar]')!.shadowRoot!;
    expect(varOf(root.querySelector('.c')!, '--c-ring')).toBe('#00ff00');
    expect(root.querySelector('.bar')!.getAttribute('style')).toContain('--s-size:90px');
    expect(root.querySelector('button.item')!.getAttribute('aria-label')).toBe(
      'Summer sale, 1 story, HOT',
    );
    client.destroy();
  });

  it('code theme is used when the server sends no appearance', () => {
    const a = themeAppearance(
      resolveTheme({ ringColors: ['#ff0000'], ringWidth: 5, hideTitles: true }),
    );
    expect(a.ring).toMatchObject({ style: 'solid', colors: ['#ff0000'], width: 5 });
    expect(a.title.hidden).toBe(true);
    expect(circleVars(a)).toContain('--c-ring:#ff0000');
  });
});

describe('createBarPreview', () => {
  it('renders the same circles with seen state and background, and updates live', () => {
    const container = document.createElement('div');
    const groups = [
      { ...base, appearance: look({ badge: { type: 'preset', text: 'NEW' } }) },
      { ...base, id: 'g2', title: 'Other' },
    ];
    const p = createBarPreview(container, { groups, background: 'dark', seen: ['g2'] });
    const root = container.querySelector('[data-stories-preview]')!.shadowRoot!;
    const circles = [...root.querySelectorAll<HTMLElement>('.c')];
    expect(circles.map((c) => c.classList.contains('seen'))).toEqual([false, true]);
    expect(root.querySelector('.badge')!.textContent).toBe('NEW');
    expect(root.querySelector('.bar')!.getAttribute('style')).toContain(
      '--stories-ring-gap-color:#111111',
    );
    expect(root.querySelector('.bar')!.getAttribute('aria-label')).toBe(
      'Story bar preview: Summer sale, Other',
    );

    p.update({
      seen: true,
      background: 'light',
      groups: [{ ...groups[0]!, appearance: look({ ring: { animation: 'pulse' } }) }],
    });
    const [only] = [...root.querySelectorAll<HTMLElement>('.c')];
    expect(only!.classList.contains('seen')).toBe(true);
    expect(root.querySelector('.badge')).toBeNull();
    expect(root.querySelector('.bar')!.getAttribute('style')).toContain('background:#ffffff');

    p.update({ reducedMotion: true, seen: false });
    expect(root.querySelector('.c')!.className).not.toContain('anim-');
    p.destroy();
    expect(container.childElementCount).toBe(0);
  });
});
