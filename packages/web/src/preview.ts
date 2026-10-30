import { type FeedGroupDto, SeenStore } from '@stories/core';
import { Viewer } from './viewer.js';

export interface PreviewOptions {
  groups: FeedGroupDto[];
  startIndex?: number;
  deepLinkSchemes?: string[];
  /**
   * Play inside this element (e.g. a phone frame) instead of full-screen. The
   * element should be position: relative and have a size.
   */
  container?: HTMLElement;
  /** Embedded only: start again from the first story after the last one. Default true. */
  loop?: boolean;
  /** Called when the viewer is closed by the user (or finishes, when not looping). */
  onClose?(): void;
}

export interface PreviewHandle {
  close(): void;
  /** Re-renders with new content, e.g. after an edit in the dashboard. */
  update(groups: FeedGroupDto[], startIndex?: number): void;
}

/**
 * Opens the real viewer on arbitrary groups (including drafts) without
 * analytics, "seen" tracking or CTA navigation. Used by the dashboard.
 */
export function previewStories(options: PreviewOptions): PreviewHandle {
  let viewer: Viewer | null = null;
  let stopped = false;
  const loop = options.container ? options.loop !== false : false;

  const start = (groups: FeedGroupDto[], startIndex: number) => {
    const playable = groups.filter((g) => g.stories.length > 0);
    if (playable.length === 0) {
      viewer = null;
      return;
    }
    viewer = new Viewer({
      feed: {
        app: { id: 'preview', deepLinkSchemes: options.deepLinkSchemes ?? [] },
        groups: playable,
      },
      groupIndex: Math.min(startIndex, playable.length - 1),
      seen: new SeenStore(null, 'preview'),
      track: () => {},
      container: options.container,
      onCtaClick: () => false,
      onClose: (reason) => {
        viewer = null;
        if (loop && reason === 'completed' && !stopped) start(groups, 0);
        else options.onClose?.();
      },
    });
    if (!viewer.isOpen) viewer = null;
  };

  start(options.groups, options.startIndex ?? 0);
  return {
    close() {
      stopped = true;
      viewer?.close();
    },
    update(groups, startIndex = 0) {
      stopped = false;
      viewer?.destroy();
      start(groups, startIndex);
    },
  };
}
