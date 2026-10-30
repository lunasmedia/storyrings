/**
 * The viewer (playback, gestures, stickers, sharing) is most of the SDK, and most visitors never
 * open a story. So it's loaded separately: when a circle is first pointed at, focused or tapped.
 */
import { importViewer } from './import-viewer.js';
import type * as ViewerModule from './viewer.js';

export type ViewerModuleType = typeof ViewerModule;

let loaded: ViewerModuleType | null = null;
let pending: Promise<ViewerModuleType> | null = null;

/** The viewer, if it has loaded. */
export const loadedViewer = (): ViewerModuleType | null => loaded;

/** Loads the viewer once. A failed load is retried on the next call. */
export function loadViewer(): Promise<ViewerModuleType> {
  pending ??= importViewer().then(
    (m) => (loaded = m),
    (err) => {
      pending = null;
      throw err;
    },
  );
  return pending;
}
