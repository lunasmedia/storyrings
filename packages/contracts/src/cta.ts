/**
 * Dependency-free helpers shared with the SDKs (import from
 * "@stories/contracts/cta" to avoid pulling Zod into SDK bundles).
 */

/** Schemes that may never be used for CTA links or deep-link allowlists. */
export const BLOCKED_SCHEMES: ReadonlySet<string> = new Set([
  'javascript',
  'data',
  'vbscript',
  'file',
  'blob',
  'about',
]);

/**
 * A CTA link is allowed when it is an absolute http(s) URL or uses one of the
 * app's registered deep-link schemes. Parsed with a regex rather than `URL`
 * because React Native's URL implementation is incomplete.
 */
export function isAllowedCtaUrl(url: string, deepLinkSchemes: readonly string[] = []): boolean {
  // Control characters and whitespace can be used to smuggle schemes past naive checks.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional
  if (/[\u0000- \u007f]/.test(url)) return false;
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(url);
  if (!match) return false;
  const scheme = match[1]!.toLowerCase();
  const rest = match[2]!;
  if (BLOCKED_SCHEMES.has(scheme)) return false;
  if (scheme === 'http' || scheme === 'https') return /^\/\/[^/?#]+/.test(rest);
  return deepLinkSchemes.includes(scheme) && rest.length > 0;
}

/**
 * How the story button looks. Buttons: a white pill, a dark pill, or an outline. Swipe ups: a
 * chevron over the label, or over a white pill; swiping up on the story then opens the link.
 */
export const CTA_STYLES = ['pill', 'dark', 'outline', 'swipe', 'swipe-pill'] as const;
export type CtaStyle = (typeof CTA_STYLES)[number];

/** A story button's style; anything unknown (or none, from older servers) is "pill". */
export function ctaStyle(style: unknown): CtaStyle {
  return (CTA_STYLES as readonly unknown[]).includes(style) ? (style as CtaStyle) : 'pill';
}

/** Swipe-up styles, where swiping up on the story opens the link. */
export function isSwipeCta(style: CtaStyle): boolean {
  return style === 'swipe' || style === 'swipe-pill';
}
