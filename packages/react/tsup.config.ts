import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm', 'cjs'],
  dts: true,
  target: 'es2019',
  clean: true,
  sourcemap: true,
  external: ['react', '@lunasmedia/storyrings-web'],
  banner: { js: "'use client';" },
});
