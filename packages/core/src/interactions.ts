import type { AnswerResultsDto, FeedInteractionDto } from '@stories/contracts/sdk-types';
import type { KeyValueStorage } from './seen';

export type { AnswerResultsDto, FeedInteractionDto } from '@stories/contracts/sdk-types';

/** Interactive stickers are laid out in units of their displayed width / 600. */
export const INTERACTION_UNITS = 600;
export const DEFAULT_ACCENT = '#c2255c';
export const DEFAULT_SLIDER_EMOJI = '😍';
export const CORRECT_COLOR = '#2f9e44';
export const WRONG_COLOR = '#e03131';
export const ANSWERS_MAX_IDS = 200;
const DESIGN_W = 1080;
const DESIGN_H = 1920;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);

/** A story's `interactions` from the feed; malformed stickers are dropped (spec: interactions). */
export function parseInteractions(raw: unknown): FeedInteractionDto[] {
  if (!Array.isArray(raw)) return [];
  const out: FeedInteractionDto[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || !isNum(r.x) || !isNum(r.y) || !isNum(r.width) || r.width <= 0) {
      continue;
    }
    const base = {
      id: r.id,
      x: r.x,
      y: r.y,
      width: r.width,
      accent:
        typeof r.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.accent)
          ? r.accent
          : DEFAULT_ACCENT,
    };
    const options = Array.isArray(r.options)
      ? r.options.filter((o): o is string => typeof o === 'string').slice(0, 4)
      : [];
    switch (r.kind) {
      case 'poll':
        if (options.length >= 2)
          out.push({ ...base, kind: 'poll', question: str(r.question), options });
        break;
      case 'quiz':
        if (
          options.length >= 2 &&
          Number.isInteger(r.correct) &&
          (r.correct as number) >= 0 &&
          (r.correct as number) < options.length
        ) {
          out.push({
            ...base,
            kind: 'quiz',
            question: str(r.question),
            options,
            correct: r.correct as number,
          });
        }
        break;
      case 'slider':
        out.push({
          ...base,
          kind: 'slider',
          question: str(r.question),
          emoji: str(r.emoji) || DEFAULT_SLIDER_EMOJI,
        });
        break;
      case 'link':
        if (typeof r.label === 'string' && r.label && typeof r.url === 'string') {
          out.push({ ...base, kind: 'link', label: r.label, url: r.url });
        }
        break;
      case 'countdown':
        if (typeof r.endsAt === 'string' && !Number.isNaN(Date.parse(r.endsAt))) {
          out.push({ ...base, kind: 'countdown', title: str(r.title), endsAt: r.endsAt });
        }
        break;
    }
  }
  return out;
}

export interface Placement {
  /** Centre, in the viewer's coordinates. */
  x: number;
  y: number;
  /** Displayed width. */
  width: number;
  /** Displayed pixels per design pixel. */
  scale: number;
}

/**
 * Where a sticker goes on the story image as displayed: the image (media size, or 1080 × 1920
 * when unknown) is fitted into the container, and the design space mapped onto it.
 */
export function placeInteraction(
  container: { width: number; height: number },
  media: { width: number; height: number } | null,
  fit: 'cover' | 'contain',
  i: { x: number; y: number; width: number },
): Placement {
  const mw = media?.width || DESIGN_W;
  const mh = media?.height || DESIGN_H;
  const s =
    fit === 'cover'
      ? Math.max(container.width / mw, container.height / mh)
      : Math.min(container.width / mw, container.height / mh);
  const w = mw * s;
  const h = mh * s;
  const left = (container.width - w) / 2;
  const top = (container.height - h) / 2;
  const k = w / DESIGN_W;
  return { x: left + i.x * k, y: top + (i.y * h) / DESIGN_H, width: i.width * k, scale: k };
}

/** Whole percentages that add up to 100 (largest remainder; ties go to the earlier option). */
export function percentages(counts: readonly number[]): number[] {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c * 100) / total);
  const out = exact.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]!++;
    left--;
  }
  return out;
}

export interface CountdownParts {
  ended: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function countdownParts(endsAt: string | number, now: number = Date.now()): CountdownParts {
  const end = typeof endsAt === 'number' ? endsAt : Date.parse(endsAt);
  const left = Math.floor((end - now) / 1000);
  if (!(left > 0)) return { ended: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  return {
    ended: false,
    days: Math.floor(left / 86400),
    hours: Math.floor((left % 86400) / 3600),
    minutes: Math.floor((left % 3600) / 60),
    seconds: left % 60,
  };
}

/** A person's answer to a sticker, and the results they were shown. */
export interface StoredAnswer {
  value: number;
  results?: AnswerResultsDto;
}

/**
 * Answers kept on the device, so a story shows what the person answered when they come back.
 * Keyed by story and sticker; the oldest are dropped past ANSWERS_MAX_IDS.
 */
export class AnswerStore {
  private map: Record<string, StoredAnswer> = {};
  private readonly key: string;

  constructor(
    private readonly storage: KeyValueStorage | null,
    appId: string,
  ) {
    this.key = `stories:answers:${appId}`;
  }

  async load(): Promise<void> {
    try {
      const raw = await this.storage?.getItem(this.key);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.map = parsed as Record<string, StoredAnswer>;
      }
    } catch {
      // Unreadable or blocked storage: start empty.
    }
  }

  get(storyId: string, interactionId: string): StoredAnswer | undefined {
    const a = this.map[`${storyId}:${interactionId}`];
    return a && typeof a.value === 'number' ? a : undefined;
  }

  set(storyId: string, interactionId: string, answer: StoredAnswer): void {
    const k = `${storyId}:${interactionId}`;
    delete this.map[k];
    this.map[k] = answer;
    // Keys keep insertion order, so dropping from the front drops the oldest.
    const keys = Object.keys(this.map);
    for (const old of keys.slice(0, Math.max(0, keys.length - ANSWERS_MAX_IDS))) {
      delete this.map[old];
    }
    try {
      const result = this.storage?.setItem(this.key, JSON.stringify(this.map));
      if (result instanceof Promise) result.catch(() => {});
    } catch {
      // Storage full or blocked: the answer still shows for this session.
    }
  }
}

export function answersUrl(apiUrl: string, token: string): string {
  return `${apiUrl.replace(/\/$/, '')}/v1/answers?token=${encodeURIComponent(token)}`;
}

/** Sends an answer; resolves to the results so far, or null when it couldn't be sent. */
export async function sendAnswer(
  opts: { apiUrl: string; token: string; fetch?: typeof fetch },
  body: { storyId: string; interactionId: string; value: number; viewer?: string },
): Promise<AnswerResultsDto | null> {
  try {
    const res = await (opts.fetch ?? fetch)(answersUrl(opts.apiUrl, opts.token), {
      method: 'POST',
      // text/plain: no CORS preflight.
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(body),
      credentials: 'omit',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: AnswerResultsDto };
    return json?.results && typeof json.results.total === 'number' ? json.results : null;
  } catch {
    return null;
  }
}

export const interactionLabels = {
  countdownUnits: ['days', 'hours', 'mins', 'secs'] as const,
  countdownEnded: 'Ended',
  pollOption: (option: string, percent: number) => `${option}, ${percent}%`,
  slider: (question: string) => `${question ? `${question} ` : ''}Slide to answer`.trim(),
  sliderAverage: 'Average',
};
