/**
 * User tags and story group tag filters, dependency-free so the SDKs can share them with the
 * server. Import from "@stories/contracts/tags".
 *
 * Brands pass tags for the person using their app (e.g. "london", "premium"); a story group's
 * tag filter (Edit group → Audience) decides who it's in the feed for. Tags are labels for
 * groups of people, never personal data.
 */

/** Lowercase letters, digits and . _ : - (e.g. "london", "city:london", "tier-gold"). */
export const TAG_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
export const TAG_MAX_LENGTH = 64;
/** Most tags one person can have; extra ones are ignored. */
export const MAX_USER_TAGS = 50;

/** Lowercased, trimmed, de-duplicated and sorted; anything not a valid tag is dropped. */
export function normalizeTags(tags: readonly string[] | string | null | undefined): string[] {
  const list = typeof tags === 'string' ? tags.split(',') : (tags ?? []);
  const out = new Set<string>();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().toLowerCase();
    if (TAG_PATTERN.test(tag)) out.add(tag);
  }
  return [...out].sort().slice(0, MAX_USER_TAGS);
}

/**
 * A group's own tag filter: every condition must pass (AND). "include" passes for people with
 * any of its tags; "exclude" passes for people with none of them.
 */
export interface TagCondition {
  mode: 'include' | 'exclude';
  tags: string[];
}

export const MAX_TAG_CONDITIONS = 10;

export function matchesTagFilter(
  conditions: readonly TagCondition[] | null | undefined,
  tags: ReadonlySet<string>,
): boolean {
  return (conditions ?? []).every((c) =>
    c.mode === 'include' ? c.tags.some((t) => tags.has(t)) : !c.tags.some((t) => tags.has(t)),
  );
}

/** "london or leeds, not churned" style summary for the dashboard. */
export function describeTagFilter(conditions: readonly TagCondition[] | null | undefined): string {
  return (conditions ?? [])
    .filter((c) => c.tags.length)
    .map((c) => (c.mode === 'include' ? c.tags.join(' or ') : `not ${c.tags.join(' or ')}`))
    .join(', ');
}
