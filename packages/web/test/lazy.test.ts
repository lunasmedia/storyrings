import type { FeedDto } from '@stories/core';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { init, type StoriesClient } from '../src/index.js';
import { loadedViewer, loadViewer } from '../src/load-viewer.js';

// Its own file, so the viewer starts out not loaded.

const feed: FeedDto = {
  app: { id: 'app1', deepLinkSchemes: [] },
  groups: [
    {
      id: 'gA',
      title: 'New in',
      coverUrl: 'https://cdn.test/a.png',
      updatedAt: '',
      stories: [
        {
          id: 'a1',
          type: 'image',
          url: 'https://cdn.test/a1.png',
          durationMs: 5000,
          width: 1,
          height: 1,
          alt: 'Red jacket',
          cta: null,
        },
      ],
    },
  ],
};

let client: StoriesClient | null = null;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('/v1/feed')
        ? new Response(JSON.stringify(feed), { status: 200 })
        : new Response(null, { status: 204 }),
    ),
  );
  document.body.innerHTML = '<div id="stories"></div>';
});

afterEach(() => {
  client?.destroy();
  client = null;
  vi.unstubAllGlobals();
});

it('loads the viewer when a circle is first pointed at, and opens once it has loaded', async () => {
  client = init({ token: 'pk_live_test', apiUrl: 'https://api.test', storage: null });
  const onLoad = vi.fn();
  client.mount('#stories', { onLoad });
  await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
  const bar = document.querySelector<HTMLElement>('[data-stories-bar]')!.shadowRoot!;
  const circle = bar.querySelector<HTMLButtonElement>('button.item')!;
  expect(loadedViewer()).toBeNull();

  circle.dispatchEvent(new Event('pointerover', { bubbles: true }));
  circle.click();
  // Pressed until the viewer is in.
  expect(circle.hasAttribute('data-opening')).toBe(true);
  expect(document.querySelector('[data-stories-viewer]')).toBeNull();

  await loadViewer();
  await vi.waitFor(() => expect(document.querySelector('[data-stories-viewer]')).not.toBeNull());
  expect(circle.hasAttribute('data-opening')).toBe(false);
});
