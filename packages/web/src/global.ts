/**
 * <script> tag entry: exposes window.Stories and registers <stories-bar>.
 *
 *   <script src="https://api.example.com/sdk/v1/stories.js"></script>
 *
 * The API URL defaults to the server the script came from; override with
 * data-api-url on the script tag or apiUrl in init(). The viewer is loaded on
 * demand from stories-viewer.js, next to this script.
 */

import { StoriesError } from '@stories/core';
import { init, setDefaultApiUrl, version } from './client.js';
import { defineStoriesElement } from './element.js';
import { setViewerScript } from './import-viewer-script.js';

const script = document.currentScript as HTMLScriptElement | null;
const fromAttr = script?.dataset.apiUrl;
if (fromAttr) setDefaultApiUrl(fromAttr);
else if (script?.src) setDefaultApiUrl(new URL(script.src, location.href).origin);
setViewerScript(
  new URL('stories-viewer.js', script?.src ? new URL(script.src, location.href) : location.href)
    .href,
);

defineStoriesElement();

const Stories = { init, version, StoriesError, defineStoriesElement };
(window as unknown as { Stories: typeof Stories }).Stories = Stories;
