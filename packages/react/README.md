# @lunasmedia/storyrings-react

React component for Stories, built on [`@lunasmedia/storyrings-web`](https://www.npmjs.com/package/@lunasmedia/storyrings-web).

```bash
npm install @lunasmedia/storyrings-react
```

```tsx
import { StoriesBar } from '@lunasmedia/storyrings-react';

<StoriesBar token="pk_live_…" onCtaClick={(e) => { /* … */ }} />
```

Your public token is in the Stories dashboard under **Apps & Websites**. Add your site's domain
there too: stories only load on registered domains. Works with React 17 and newer, including
server-rendered apps (the component is marked `'use client'`).

MIT licensed.
