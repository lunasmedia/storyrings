type Attr = string | number | boolean | null | undefined;
type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper: h('button', { class: 'x', 'aria-label': 'Close' }, 'text') */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, Attr> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value === null || value === undefined) continue;
    el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** Inline SVG icon (paths are 24×24, stroke-based). */
export function icon(paths: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = paths;
  return svg;
}

export const ICONS = {
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  share:
    '<path d="M12 15V3M7.5 7.5L12 3l4.5 4.5"/><path d="M8 11H6.5A1.5 1.5 0 005 12.5v7A1.5 1.5 0 006.5 21h11a1.5 1.5 0 001.5-1.5v-7a1.5 1.5 0 00-1.5-1.5H16"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  muted: '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/>',
  sound:
    '<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 8a5 5 0 010 8M19.5 5.5a8.5 8.5 0 010 13"/>',
};

export function resolveTarget(target: string | Element): HTMLElement {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!(el instanceof HTMLElement)) {
    throw new Error(`Stories: mount target ${String(target)} not found`);
  }
  return el;
}

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
