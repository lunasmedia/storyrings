import type { BarLayout } from '@stories/contracts/appearance';
import type { FeedGroupDto, StoriesTheme } from '@stories/core';
import { resolveTheme } from '@stories/core';
import { environment, renderCircle, themeAppearance } from './circle.js';
import { h } from './dom.js';
import { BAR_CSS, themeVars } from './styles.js';

export interface BarPreviewOptions {
  groups: FeedGroupDto[];
  /** Which groups to draw as "seen", or true for all. */
  seen?: string[] | boolean;
  /**
   * Background behind the bar; also used for the gap colour "background".
   * "transparent" inherits the page (set --stories-ring-gap-color on the container).
   */
  background?: 'light' | 'dark' | 'transparent';
  theme?: Partial<StoriesTheme>;
  /** Item shape and size, as set in the dashboard (overrides theme.circleSize and gap). */
  layout?: BarLayout | null;
  /** Pretend reduced motion is on (for previews/tests). Defaults to the user's setting. */
  reducedMotion?: boolean;
}

export interface BarPreviewHandle {
  update(options: Partial<BarPreviewOptions>): void;
  destroy(): void;
}

const BACKGROUNDS = { light: ['#ffffff', '#111111'], dark: ['#111111', '#f5f5f5'] } as const;

/**
 * Renders circles exactly like the story bar (same code and CSS), without
 * interaction. Used by the dashboard's "How it looks in the story bar".
 */
export function createBarPreview(
  container: HTMLElement,
  initial: BarPreviewOptions,
): BarPreviewHandle {
  const host = h('div', { 'data-stories-preview': '' });
  const root = host.attachShadow({ mode: 'open' });
  const wrapper = h('div', { class: 'bar', role: 'img' });
  root.append(h('style', {}, `${BAR_CSS}.bar{overflow:visible}.item{cursor:default}`), wrapper);
  container.append(host);
  let options = initial;

  const render = () => {
    const theme = resolveTheme(options.theme);
    const env = environment();
    if (options.reducedMotion !== undefined) env.reducedMotion = options.reducedMotion;
    const background = options.background ?? 'light';
    const colors =
      background === 'transparent'
        ? ''
        : `;background:${BACKGROUNDS[background][0]};color:${BACKGROUNDS[background][1]};--stories-ring-gap-color:${BACKGROUNDS[background][0]}`;
    wrapper.setAttribute(
      'style',
      `${themeVars(theme, options.layout)}${colors};border-radius:12px`,
    );
    wrapper.setAttribute(
      'aria-label',
      `Story bar preview: ${options.groups.map((g) => g.title).join(', ')}`,
    );
    const isSeen = (id: string) =>
      options.seen === true || (Array.isArray(options.seen) && options.seen.includes(id));
    const items = options.groups.map((g) =>
      h(
        'li',
        { 'data-group': g.id },
        h(
          'span',
          { class: 'item' },
          renderCircle(g, g.appearance ?? themeAppearance(theme), { seen: isSeen(g.id), ...env }),
        ),
      ),
    );
    wrapper.replaceChildren(h('ul', { class: 'list', role: 'presentation' }, ...items));
  };

  render();
  return {
    update(next) {
      options = { ...options, ...next };
      render();
    },
    destroy() {
      host.remove();
    },
  };
}
