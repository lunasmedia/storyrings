import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StoriesBar, type StoriesBarHandle } from '../src/index.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const feed = {
  app: { id: 'app', deepLinkSchemes: [] },
  groups: [
    {
      id: 'g1',
      title: 'Hello',
      coverUrl: 'https://cdn.test/c.png',
      updatedAt: '',
      stories: [
        {
          id: 's1',
          type: 'image',
          url: 'https://cdn.test/s.png',
          durationMs: 5000,
          width: 1,
          height: 1,
          alt: 'x',
          cta: null,
        },
      ],
    },
  ],
};

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(feed))),
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('<StoriesBar>', () => {
  it('mounts the bar, calls the latest onLoad, and exposes the handle via ref', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const ref = createRef<StoriesBarHandle | null>();
    act(() =>
      root.render(
        <StoriesBar
          ref={ref}
          token="pk_live_react"
          apiUrl="https://api.test"
          onLoad={first}
          className="bar"
        />,
      ),
    );
    // Swap the callback before the feed resolves: the new one is used, no remount.
    act(() =>
      root.render(
        <StoriesBar
          ref={ref}
          token="pk_live_react"
          apiUrl="https://api.test"
          onLoad={second}
          className="bar"
        />,
      ),
    );
    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
    expect(host.querySelectorAll('[data-stories-bar]')).toHaveLength(1);
    expect(host.querySelector('.bar')).not.toBeNull();
    expect(ref.current?.groups.map((g) => g.id)).toEqual(['g1']);
  });

  it('applies theme changes without remounting and cleans up on unmount', async () => {
    const onLoad = vi.fn();
    act(() =>
      root.render(
        <StoriesBar
          token="pk_live_react2"
          apiUrl="https://api.test"
          onLoad={onLoad}
          theme={{ circleSize: 60 }}
        />,
      ),
    );
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
    const barRoot = () => host.querySelector('[data-stories-bar]')!.shadowRoot!;
    expect(barRoot().querySelector('.bar')!.getAttribute('style')).toContain('--s-size:60px');
    const before = host.querySelector('[data-stories-bar]');
    act(() =>
      root.render(
        <StoriesBar
          token="pk_live_react2"
          apiUrl="https://api.test"
          onLoad={onLoad}
          theme={{ circleSize: 90 }}
        />,
      ),
    );
    expect(host.querySelector('[data-stories-bar]')).toBe(before);
    expect(barRoot().querySelector('.bar')!.getAttribute('style')).toContain('--s-size:90px');
    act(() => root.render(<span />));
    expect(host.querySelector('[data-stories-bar]')).toBeNull();
  });
});
