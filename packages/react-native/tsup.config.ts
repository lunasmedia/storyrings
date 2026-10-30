import { defineConfig } from 'tsup';

// npm package. CJS only: esbuild keeps `require` as is in CJS, so the optional
// requires in src/optional.ts still sit in try blocks where Metro expects them.
export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs'],
  outExtension: () => ({ js: '.js' }),
  // Inline only our own workspace types; never third-party ones.
  dts: { resolve: [/^@stories\//] },
  tsconfig: 'tsconfig.build.json',
  target: 'es2020',
  clean: true,
  sourcemap: true,
  // Workspace packages ship TypeScript source; bundle them so the SDK has no runtime deps.
  noExternal: ['@stories/core', '@stories/contracts'],
  external: [
    'react',
    'react-native',
    'react-native-video',
    'react-native-safe-area-context',
    '@react-native-async-storage/async-storage',
  ],
});
