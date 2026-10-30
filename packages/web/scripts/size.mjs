import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

// stories.js loads with the page; stories-viewer.js only when a visitor goes to open a story.
const BUDGETS = { 'stories.js': 12, 'stories-viewer.js': 16 };
let over = false;
for (const [name, kb] of Object.entries(BUDGETS)) {
  const gz = gzipSync(readFileSync(new URL(`../dist/${name}`, import.meta.url))).length;
  console.log(`${name}: ${(gz / 1024).toFixed(1)} KB gzipped (budget ${kb} KB)`);
  if (gz > kb * 1024) over = true;
}
if (over) {
  console.error('Bundle exceeds the size budget');
  process.exit(1);
}
