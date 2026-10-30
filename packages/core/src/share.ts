/**
 * Shared story links: the page the story bar is on, with the story in the URL
 * fragment, e.g. https://news.example.com/article#stories=<groupId>/<storyId>.
 * The fragment never reaches the website's server, so any page works as-is;
 * the SDK on that page reads it and opens the story.
 */
const PREFIX = '#stories=';

export interface ShareTarget {
  groupId: string;
  /** Absent: open the group where the viewer left off. */
  storyId?: string;
}

/** Link to a story on the given page (any existing fragment is replaced). */
export function shareUrl(pageUrl: string, target: ShareTarget): string {
  const url = new URL(pageUrl);
  url.hash = `${PREFIX.slice(1)}${encodeURIComponent(target.groupId)}${
    target.storyId ? `/${encodeURIComponent(target.storyId)}` : ''
  }`;
  return url.toString();
}

/** The story a URL links to, or null if it isn't a shared story link. */
export function parseShareLink(url: string): ShareTarget | null {
  let hash: string;
  try {
    hash = new URL(url).hash;
  } catch {
    return null;
  }
  if (!hash.startsWith(PREFIX)) return null;
  const [group, story, ...rest] = hash.slice(PREFIX.length).split('/');
  if (!group || rest.length > 0) return null;
  try {
    const groupId = decodeURIComponent(group);
    return story ? { groupId, storyId: decodeURIComponent(story) } : { groupId };
  } catch {
    return null;
  }
}

/** The URL without a shared-story fragment (other fragments are kept). */
export function withoutShareLink(url: string): string {
  if (!parseShareLink(url)) return url;
  const u = new URL(url);
  u.hash = '';
  return u.toString().replace(/#$/, '');
}

/**
 * A mobile app's link to a story: its share link template (set in the dashboard) with
 * {group} and {story} filled in.
 */
export function appShareUrl(template: string, target: Required<ShareTarget>): string {
  // split/join rather than replaceAll, for older JavaScript engines in apps.
  return template
    .split('{group}')
    .join(encodeURIComponent(target.groupId))
    .split('{story}')
    .join(encodeURIComponent(target.storyId));
}
