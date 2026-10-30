/** <script> build: the viewer is stories-viewer.js, next to stories.js. */
import type * as ViewerModule from './viewer.js';

type Global = { __storiesViewer?: typeof ViewerModule };

let url = '';

export function setViewerScript(src: string): void {
  url = src;
}

export function importViewer(): Promise<typeof ViewerModule> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.onload = () => {
      const viewer = (window as unknown as Global).__storiesViewer;
      if (viewer) resolve(viewer);
      else reject(new Error(`${url} didn't load the Stories viewer`));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`Could not load ${url}`));
    };
    document.head.append(script);
  });
}
