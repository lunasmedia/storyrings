import { resolveBarLayout } from '@stories/contracts/appearance';
import type { FeedDto, FeedGroupDto } from '@stories/contracts/sdk-types';
import { normalizeTags } from '@stories/contracts/tags';
import { parseInteractions } from './interactions';

export type StoriesErrorCode =
  | 'invalid_token'
  | 'origin_not_allowed'
  | 'unknown_bar'
  | 'network'
  | 'server'
  | 'invalid_response';

export class StoriesError extends Error {
  constructor(
    readonly code: StoriesErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'StoriesError';
  }
}

export interface FetchFeedOptions {
  apiUrl: string;
  token: string;
  /** Key of the story bar to load (set in the dashboard); omitted = the main bar. */
  bar?: string;
  /**
   * Tags for the person using the app (e.g. ["london", "premium"]), from the brand's own
   * user data. Groups with a tag filter only show to people whose tags pass it.
   */
  tags?: readonly string[];
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export function feedUrl(
  apiUrl: string,
  token: string,
  bar?: string,
  tags?: readonly string[],
): string {
  let url = `${apiUrl.replace(/\/$/, '')}/v1/feed?token=${encodeURIComponent(token)}`;
  if (bar) url += `&bar=${encodeURIComponent(bar)}`;
  // Normalised (sorted, lowercase) so the same person always gets the same cached feed.
  const list = normalizeTags(tags);
  if (list.length) url += `&tags=${encodeURIComponent(list.join(','))}`;
  return url;
}

export function eventsUrl(apiUrl: string, token: string): string {
  return `${apiUrl.replace(/\/$/, '')}/v1/events?token=${encodeURIComponent(token)}`;
}

/** Fetches published story groups for a token. Throws StoriesError. */
export async function fetchFeed(opts: FetchFeedOptions): Promise<FeedDto> {
  const doFetch = opts.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(feedUrl(opts.apiUrl, opts.token, opts.bar, opts.tags), {
      signal: opts.signal,
      credentials: 'omit',
    });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new StoriesError('network', 'Could not reach the Stories API');
  }

  if (res.status === 401) throw new StoriesError('invalid_token', 'Invalid Stories token', 401);
  if (res.status === 403) {
    throw new StoriesError(
      'origin_not_allowed',
      'This website is not registered for this token. Add it under Allowed origins in the dashboard.',
      403,
    );
  }
  if (res.status === 404 && opts.bar) {
    throw new StoriesError(
      'unknown_bar',
      `No story bar with the key "${opts.bar}" for this token. Check the key under Settings → Apps & websites in the dashboard.`,
      404,
    );
  }
  if (!res.ok) throw new StoriesError('server', `Stories API error (${res.status})`, res.status);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new StoriesError('invalid_response', 'Stories API returned invalid JSON', res.status);
  }
  return normalizeFeed(body);
}

/** Defensive parsing: drop anything malformed rather than crash the host page/app. */
export function normalizeFeed(body: unknown): FeedDto {
  const b = body as Partial<FeedDto> | null;
  if (!b || typeof b !== 'object' || !Array.isArray(b.groups) || !b.app) {
    throw new StoriesError('invalid_response', 'Unexpected feed format');
  }
  const groups = b.groups
    .filter(
      (g): g is FeedGroupDto =>
        !!g && typeof g.id === 'string' && typeof g.title === 'string' && Array.isArray(g.stories),
    )
    .map((g) => ({
      ...g,
      stories: g.stories
        .filter(
          (s) =>
            !!s &&
            typeof s.id === 'string' &&
            typeof s.url === 'string' &&
            (s.type === 'image' || s.type === 'video') &&
            typeof s.durationMs === 'number' &&
            s.durationMs > 0,
        )
        .map((s) =>
          s.interactions === undefined
            ? s
            : { ...s, interactions: parseInteractions(s.interactions) },
        ),
    }))
    .filter((g) => g.stories.length > 0);
  return {
    ...(b.bar && typeof b.bar.key === 'string'
      ? { bar: { id: String(b.bar.id), key: b.bar.key } }
      : {}),
    app: {
      id: String(b.app.id),
      deepLinkSchemes: b.app.deepLinkSchemes ?? [],
      sharing: b.app.sharing === true,
      ...(typeof b.app.shareLink === 'string' ? { shareLink: b.app.shareLink } : {}),
      ...(b.app.layout && typeof b.app.layout === 'object'
        ? { layout: resolveBarLayout(b.app.layout) }
        : {}),
    },
    groups,
  };
}
