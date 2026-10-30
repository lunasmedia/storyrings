import {
  init,
  type MountOptions,
  type StoriesBarHandle,
  type StoriesClient,
  type StoriesTheme,
} from '@lunasmedia/storyrings-web';
import {
  type CSSProperties,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from 'react';

export type {
  CtaClickEvent,
  FeedGroupDto,
  StoriesBarHandle,
  StoriesError,
  StoriesTheme,
  StoryOpenEvent,
} from '@lunasmedia/storyrings-web';

export interface StoriesBarProps extends Omit<MountOptions, 'theme'> {
  /** Public token from the dashboard. */
  token: string;
  /** API base URL (defaults to the SDK's configured server). */
  apiUrl?: string;
  theme?: Partial<StoriesTheme>;
  /** Disable analytics events. */
  analytics?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** One client per token/API URL, shared by every bar in the app. */
const clients = new Map<string, StoriesClient>();
function getClient(token: string, apiUrl?: string, analytics?: boolean) {
  const key = `${token}|${apiUrl ?? ''}|${analytics !== false}`;
  let client = clients.get(key);
  if (!client) {
    client = init({ token, apiUrl, analytics });
    clients.set(key, client);
  }
  return client;
}

/**
 * Renders the story bar. Callbacks can change between renders without
 * remounting; changing token/apiUrl/bar remounts. Changing `tags` (e.g. after sign-in)
 * reloads the feed for the new tags.
 *
 *   <StoriesBar token="pk_live_…" onCtaClick={(e) => { navigate(e.url); e.close(); return false; }} />
 *   <StoriesBar token="pk_live_…" bar="product-page" />   (a second story bar)
 *   <StoriesBar token="pk_live_…" tags={['london', 'premium']} />   (the viewer's tags)
 */
export const StoriesBar = forwardRef<StoriesBarHandle | null, StoriesBarProps>(function StoriesBar(
  { token, apiUrl, bar, tags, analytics, theme, ctaTarget, className, style, ...callbacks },
  ref,
) {
  const container = useRef<HTMLDivElement>(null);
  const handle = useRef<StoriesBarHandle | null>(null);
  // Compare themes by value so inline objects don't trigger updates on every render.
  const themeKey = JSON.stringify(theme ?? {});
  const stableTheme = useMemo<Partial<StoriesTheme>>(() => JSON.parse(themeKey), [themeKey]);
  // Tags by value too: a new array with the same tags shouldn't reload the feed.
  const tagsKey = (tags ?? []).join(',');
  const stableTags = useMemo(() => (tagsKey ? tagsKey.split(',') : []), [tagsKey]);
  const latest = useRef({ ...callbacks, theme: stableTheme, ctaTarget, tags: stableTags });
  latest.current = { ...callbacks, theme: stableTheme, ctaTarget, tags: stableTags };

  // The bar is mounted in an effect (after refs are attached), so expose a
  // stable proxy that delegates to whichever bar is currently mounted.
  useImperativeHandle(
    ref,
    (): StoriesBarHandle => ({
      get groups() {
        return handle.current?.groups ?? [];
      },
      open: (group) => handle.current?.open(group) ?? false,
      close: () => handle.current?.close(),
      refresh: () => handle.current?.refresh() ?? Promise.resolve(),
      update: (options) => handle.current?.update(options),
      destroy: () => handle.current?.destroy(),
    }),
    [],
  );

  // Theme and ctaTarget are read from `latest` so changing them doesn't remount;
  // the update effect below applies them to the mounted bar.
  useEffect(() => {
    if (!container.current) return;
    const mounted = getClient(token, apiUrl, analytics).mount(container.current, {
      bar,
      tags: latest.current.tags,
      theme: latest.current.theme,
      ctaTarget: latest.current.ctaTarget,
      onLoad: (groups) => latest.current.onLoad?.(groups),
      onFail: (error) => latest.current.onFail?.(error),
      onStoryOpen: (e) => latest.current.onStoryOpen?.(e),
      onClose: (reason) => latest.current.onClose?.(reason),
      onCtaClick: (e) => latest.current.onCtaClick?.(e),
      onShare: (e) => latest.current.onShare?.(e),
      openSharedLinks: latest.current.openSharedLinks,
    });
    handle.current = mounted;
    return () => {
      mounted.destroy();
      handle.current = null;
    };
  }, [token, apiUrl, bar, analytics]);

  useEffect(() => {
    handle.current?.update({ theme: stableTheme, ctaTarget, tags: stableTags });
  }, [stableTheme, ctaTarget, stableTags]);

  return <div ref={container} className={className} style={style} />;
});
