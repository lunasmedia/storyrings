import { fileURLToPath } from 'node:url';
import { defineConfig, type Options } from 'tsup';

const define = {
  __STORIES_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  __STORIES_API_URL__: JSON.stringify(
    process.env.STORIES_API_URL ?? 'https://stories-dashboard.fly.dev',
  ),
};
// Workspace packages ship TypeScript source; bundle them so the SDK has no runtime deps.
const noExternal = ['@stories/core', '@stories/contracts'];
const script = {
  format: ['iife'],
  outExtension: () => ({ js: '.js' }),
  // ES2020 keeps ?. and ?? native (Safari 14+); the CSS already needs Safari 15+.
  target: 'es2020',
  minify: true,
  sourcemap: true,
  noExternal,
  define,
} satisfies Options;

export default defineConfig([
  // npm package: ESM + CJS + types
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    // Inline only our own workspace types; never third-party ones.
    dts: { resolve: [/^@stories\//] },
    tsconfig: 'tsconfig.build.json',
    target: 'es2019',
    clean: true,
    sourcemap: true,
    noExternal,
    define,
  },
  // <script> tag build: window.Stories + <stories-bar> element. The viewer is its own file,
  // stories-viewer.js, loaded when a circle is first pointed at or tapped.
  {
    entry: { stories: 'src/global.ts' },
    ...script,
    esbuildPlugins: [
      {
        name: 'viewer-script',
        setup(build) {
          build.onResolve({ filter: /^\.\/import-viewer\.js$/ }, () => ({
            path: fileURLToPath(new URL('src/import-viewer-script.ts', import.meta.url)),
          }));
        },
      },
    ],
  },
  { entry: { 'stories-viewer': 'src/viewer-global.ts' }, ...script },
]);
