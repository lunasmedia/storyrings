// npm build: a code-split chunk the app's bundler loads on demand.
// The <script> build swaps this file for import-viewer-script.ts (see tsup.config.ts).
export const importViewer = () => import('./viewer.js');
