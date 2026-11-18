import {
  type Appearance,
  badgeLabel,
  DEFAULT_APPEARANCE,
  resolveAppearance,
} from '@stories/contracts/appearance';
import type { FeedGroupDto, StoriesTheme } from '@stories/core';
import { h } from './dom.js';

export interface CircleState {
  seen: boolean;
  /** prefers-reduced-motion: no ring animation, animated covers show their poster. */
  reducedMotion: boolean;
  /** Save-Data or a 2G connection: animated covers show their poster. */
  lowData: boolean;
  now?: number;
}

/**
 * Appearance used when the server sends none (older servers): built from the
 * developer's code theme. When the server does send one, the dashboard wins
 * for ring/badge/title; the code theme still controls size, spacing and font.
 */
export function themeAppearance(theme: StoriesTheme): Appearance {
  return resolveAppearance({
    ring: {
      style: theme.ringColors.length > 1 ? 'gradient' : 'solid',
      colors: theme.ringColors.slice(0, 3),
      width: theme.ringWidth,
      gap: theme.ringGap,
      seenColor: theme.seenRingColor,
    },
    title: {
      hidden: theme.hideTitles,
      color: theme.titleColor === 'currentColor' ? 'inherit' : theme.titleColor,
    },
  });
}

const SPEED = { slow: '4s', normal: '2.4s', fast: '1.2s' } as const;

/** CSS custom properties for one circle. */
export function circleVars(a: Appearance): string {
  const { ring, title, badge } = a;
  const colors = ring.colors.length ? ring.colors : DEFAULT_APPEARANCE.ring.colors;
  const paint =
    ring.style === 'none'
      ? 'transparent'
      : ring.style === 'solid' || colors.length === 1
        ? colors[0]!
        : `linear-gradient(${ring.angle}deg, ${colors.join(', ')})`;
  const gapColor =
    ring.gapColor === 'background' ? 'var(--stories-ring-gap-color, Canvas)' : ring.gapColor;
  return [
    `--c-ring:${paint}`,
    `--c-conic:conic-gradient(${[...colors, colors[0]].join(', ')})`,
    `--c-glow:${colors[0]}`,
    `--c-ring-w:${ring.style === 'none' ? 0 : ring.width}px`,
    `--c-gap:${ring.gap}px`,
    `--c-gap-color:${gapColor}`,
    `--c-seen:${ring.seenColor}`,
    `--c-speed:${SPEED[ring.speed]}`,
    `--c-title:${title.color === 'inherit' ? 'var(--s-title-color)' : title.color}`,
    `--c-weight:${title.weight}`,
    `--c-lines:${title.maxLines}`,
    `--c-badge-bg:${badge.background}`,
    `--c-badge-fg:${badge.color}`,
  ].join(';');
}

/** Text for the circle's accessible name, e.g. ", SALE" or ", ends in 5h". */
export function badgeSpeech(
  a: Appearance,
  endsAt: string | null | undefined,
  now?: number,
): string {
  const text = badgeLabel(a.badge, endsAt, now);
  if (!text) return '';
  return a.badge.type === 'countdown' ? `, ends in ${text}` : `, ${text}`;
}

/**
 * The circle as drawn in the story bar: ring (style, animation, seen colour),
 * cover (still, or looping muted video for animated covers), badge and title.
 * Used by the bar and by createBarPreview(), so both always match.
 */
export function renderCircle(
  group: FeedGroupDto,
  appearance: Appearance,
  state: CircleState,
): HTMLElement {
  const { ring, badge, title } = appearance;
  const animate =
    ring.animation !== 'none' &&
    ring.style !== 'none' &&
    !state.reducedMotion &&
    !(state.seen && ring.animateOnlyUnseen);

  const cover = group.cover ?? { image: group.coverUrl, animated: false };
  const img = h('img', {
    class: 'cover',
    src: cover.image,
    alt: '',
    loading: 'lazy',
    draggable: 'false',
  });
  const animatedCover = cover.animated && cover.video && !state.reducedMotion && !state.lowData;
  // What it shows, so a re-render can keep it (already loaded and playing) instead of a new one.
  const media = h(
    'span',
    { class: 'img', 'data-media': `circle ${cover.image} ${animatedCover ? cover.video : ''}` },
    img,
  );
  if (animatedCover && cover.video) {
    const video = h('video', {
      class: 'cover anim',
      muted: true,
      loop: true,
      autoplay: true,
      playsinline: true,
      preload: 'metadata',
      poster: cover.image,
      'aria-hidden': 'true',
      disablepictureinpicture: true,
    });
    video.muted = true;
    video.playsInline = true;
    // Show the motion only once it actually plays; until then (or on error) the poster stays.
    video.addEventListener('playing', () => media.classList.add('playing'));
    video.addEventListener('error', () => video.remove());
    video.src = cover.video;
    media.append(video);
  }

  const label = badgeLabel(badge, group.endsAt, state.now);
  const classes = [
    'c',
    state.seen ? 'seen' : '',
    ring.style === 'none' ? 'no-ring' : '',
    animate ? `anim-${ring.animation}` : '',
  ];
  return h(
    'span',
    { class: classes.filter(Boolean).join(' '), style: circleVars(appearance) },
    h(
      'span',
      { class: 'ring' },
      // Animated layers sit on the ring, under the image, clipped to the ring band.
      animate && ring.animation === 'rotate' && h('span', { class: 'spin', 'aria-hidden': 'true' }),
      animate &&
        ring.animation === 'shimmer' &&
        h('span', { class: 'shine', 'aria-hidden': 'true' }),
      h('span', { class: 'gap' }, media),
      label &&
        h(
          'span',
          {
            class: `badge ${badge.position === 'top-right' ? 'tr' : 'bc'}`,
            'aria-hidden': 'true',
            'data-badge': badge.type,
          },
          label,
        ),
    ),
    !title.hidden && h('span', { class: 'title', 'aria-hidden': 'true' }, group.title),
  );
}

/** Current environment hints for animated covers and ring animations. */
export function environment(): Pick<CircleState, 'reducedMotion' | 'lowData'> {
  const reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const conn = (navigator as { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  const lowData = !!conn && (conn.saveData === true || /(^|-)2g$/.test(conn.effectiveType ?? ''));
  return { reducedMotion, lowData };
}

/** Energized cards: the circle in the middle is this share of the card's width. */
export const ENERGIZED_AVATAR = 0.5;

/**
 * An Energized style card: a story-shaped card showing a still of the group's first story (which
 * plays on its turn; the cover until the still loads), the group's circle in the middle (ring,
 * animation, seen colour and badge as usual) and the title inside the card at the bottom.
 */
export function renderCard(
  group: FeedGroupDto,
  appearance: Appearance,
  state: CircleState & { width: number },
): HTMLElement {
  const size = Math.round(state.width * ENERGIZED_AVATAR);
  const circle = renderCircle(
    group,
    { ...appearance, title: { ...appearance.title, hidden: true } },
    state,
  );
  circle.classList.add('avatar');
  circle.setAttribute(
    'style',
    `${circle.getAttribute('style')};--s-size:${size}px;--s-h:${size}px;--s-r:${size / 2}px`,
  );
  const cover = group.cover ?? { image: group.coverUrl, animated: false };
  const still = group.stories[0];
  const stillEl = cardStill(still, state.lowData);
  const bg = h(
    'span',
    {
      // With a still, the cover stays hidden behind it (it only shows if the still can't load),
      // so it never flashes before the still.
      class: `card-bg${stillEl ? ' has-still' : ''}`,
      // What it shows, so a re-render can keep it (already loaded) instead of a new one.
      'data-media': `card ${cover.image} ${still ? `${still.type} ${still.url}` : ''} ${state.lowData}`,
    },
    h('img', {
      class: 'cover',
      src: cover.image,
      alt: '',
      loading: 'lazy',
      draggable: 'false',
    }),
    stillEl,
  );
  stillEl?.addEventListener('error', () => {
    bg.classList.remove('has-still');
    stillEl.remove();
  });
  return h(
    'span',
    { class: `card${state.seen ? ' seen' : ''}`, style: circleVars(appearance) },
    bg,
    h('span', { class: 'scrim', 'aria-hidden': 'true' }),
    circle,
    !appearance.title.hidden && h('span', { class: 'title', 'aria-hidden': 'true' }, group.title),
  );
}

/**
 * An Energized card's still: its first story (the one it previews) as an image, or a video's
 * first frame (not on low data: that fetches the start of the video). Shows at once when the
 * image is already loaded (the bar preloads them), otherwise fades in when it is. If it can't
 * load it fires `error`, and the card shows the cover instead.
 */
export function cardStill(
  story: FeedGroupDto['stories'][number] | undefined,
  lowData: boolean,
): HTMLElement | null {
  if (!story || (story.type === 'video' && lowData)) return null;
  if (story.type === 'video') {
    const video = h('video', {
      class: 'cover still',
      muted: true,
      playsinline: true,
      preload: 'metadata',
      disablepictureinpicture: true,
      'aria-hidden': 'true',
    });
    video.muted = true;
    video.playsInline = true;
    video.addEventListener('loadeddata', () => video.classList.add('on'), { once: true });
    // A moment in, so browsers that only draw a frame once seeked (iOS Safari) show one.
    video.src = `${story.url}#t=0.001`;
    return video;
  }
  const img = h('img', { class: 'cover still', alt: '', draggable: 'false' });
  img.addEventListener('load', () => img.classList.add('on'), { once: true });
  img.src = story.url;
  // Already in memory (preloaded with the feed): shown straight away, with no fade.
  if (img.complete && img.naturalWidth) img.classList.add('on');
  return img;
}
