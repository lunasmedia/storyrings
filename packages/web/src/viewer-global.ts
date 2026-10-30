/** <script> build of the viewer (stories-viewer.js), loaded by stories.js when it's needed. */
import * as viewer from './viewer.js';

(window as unknown as { __storiesViewer?: typeof viewer }).__storiesViewer = viewer;
