# @lunasmedia/storyrings-web

Instagram-style stories for any website: framework-free and accessible.

```bash
npm install @lunasmedia/storyrings-web
```

```html
<div id="stories"></div>
```

```js
import { init } from '@lunasmedia/storyrings-web';

init({ token: 'pk_live_…' }).mount('#stories');
```

Your public token is in the Stories dashboard under **Apps & Websites**. Add your site's domain
there too: stories only load on registered domains.

Options include `apiUrl` (your own Stories server), `analytics: false`, and callbacks such as
`onCtaClick`. Using React? See [`@lunasmedia/storyrings-react`](https://www.npmjs.com/package/@lunasmedia/storyrings-react).

MIT licensed.
