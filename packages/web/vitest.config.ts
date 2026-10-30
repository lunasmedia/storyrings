import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __STORIES_VERSION__: JSON.stringify('test'),
    __STORIES_API_URL__: JSON.stringify('https://api.test'),
  },
  test: { environment: 'jsdom' },
});
