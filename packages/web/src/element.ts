import type { StoriesTheme } from '@stories/core';
import type { StoriesBarHandle } from './bar.js';
import { init, type StoriesClient } from './client.js';

const THEME_ATTRS = {
  'circle-size': ['circleSize', Number],
  'ring-width': ['ringWidth', Number],
  'ring-gap': ['ringGap', Number],
  'ring-colors': ['ringColors', (v: string) => v.split(',').map((c) => c.trim())],
  'seen-ring-color': ['seenRingColor', String],
  'title-color': ['titleColor', String],
  'title-font': ['titleFont', String],
  'title-size': ['titleSize', Number],
  'hide-titles': ['hideTitles', () => true],
  'bar-padding': ['barPadding', Number],
  gap: ['gap', Number],
} as const satisfies Record<string, readonly [keyof StoriesTheme, (v: string) => unknown]>;

/** One client per token/API URL, shared by all elements on the page. */
const clients = new Map<string, StoriesClient>();

/**
 * Registers <stories-bar>. Callbacks are DOM events:
 * stories-load, stories-fail, stories-open, stories-close, stories-cta and stories-share
 * (stories-cta and stories-share are cancelable: call event.preventDefault() to handle
 * the link or the sharing yourself).
 *
 *   <stories-bar token="pk_live_…" circle-size="72"></stories-bar>
 *   <stories-bar token="pk_live_…" bar="product-page"></stories-bar>  (a second story bar)
 *   <stories-bar token="pk_live_…" tags="london,premium"></stories-bar>  (the viewer's tags)
 */
export function defineStoriesElement(tagName = 'stories-bar'): void {
  if (typeof customElements === 'undefined' || customElements.get(tagName)) return;

  class StoriesBarElement extends HTMLElement {
    static observedAttributes = [
      'token',
      'api-url',
      'bar',
      'tags',
      'cta-target',
      'transition',
      ...Object.keys(THEME_ATTRS),
    ];
    private handle: StoriesBarHandle | null = null;

    connectedCallback() {
      this.mount();
    }

    disconnectedCallback() {
      this.handle?.destroy();
      this.handle = null;
    }

    attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
      if (oldValue === newValue || !this.isConnected) return;
      // The token may be set after the element is already in the page.
      if (!this.handle) return this.mount();
      if (name === 'token' || name === 'api-url' || name === 'bar') {
        this.handle.destroy();
        this.handle = null;
        this.mount();
      } else {
        this.handle.update({
          theme: this.theme(),
          ctaTarget: this.ctaTarget(),
          transition: this.transition(),
          tags: this.tags(),
        });
      }
    }

    get stories(): StoriesBarHandle | null {
      return this.handle;
    }

    private theme(): Partial<StoriesTheme> {
      const theme: Record<string, unknown> = {};
      for (const [attr, [key, parse]] of Object.entries(THEME_ATTRS)) {
        const value = this.getAttribute(attr);
        if (value !== null) theme[key] = parse(value);
      }
      return theme as Partial<StoriesTheme>;
    }

    /** tags="london,premium": the viewer's tags, for groups with a tag filter. */
    private tags(): string[] {
      return (this.getAttribute('tags') ?? '').split(',');
    }

    private ctaTarget() {
      return this.getAttribute('cta-target') === '_blank'
        ? ('_blank' as const)
        : ('_self' as const);
    }

    /** transition="zoom": out of the clicked circle and back into it (default: slide). */
    private transition() {
      return this.getAttribute('transition') === 'zoom' ? ('zoom' as const) : ('slide' as const);
    }

    private emit(name: string, detail: unknown, cancelable = false): boolean {
      return this.dispatchEvent(
        new CustomEvent(name, { detail, bubbles: true, composed: true, cancelable }),
      );
    }

    private mount() {
      const token = this.getAttribute('token');
      if (!token || this.handle) return;
      const apiUrl = this.getAttribute('api-url') ?? undefined;
      const key = `${token}|${apiUrl ?? ''}`;
      let client = clients.get(key);
      if (!client) {
        client = init({ token, apiUrl });
        clients.set(key, client);
      }
      this.handle = client.mount(this, {
        bar: this.getAttribute('bar') ?? undefined,
        tags: this.tags(),
        theme: this.theme(),
        ctaTarget: this.ctaTarget(),
        transition: this.transition(),
        onLoad: (groups) => this.emit('stories-load', { groups }),
        onFail: (error) => this.emit('stories-fail', { error }),
        onStoryOpen: (e) => this.emit('stories-open', e),
        onClose: (reason) => this.emit('stories-close', { reason }),
        onCtaClick: (e) => this.emit('stories-cta', e, true),
        // Cancel the event (preventDefault) to handle sharing yourself.
        onShare: (e) => this.emit('stories-share', e, true),
      });
    }
  }

  customElements.define(tagName, StoriesBarElement);
}
