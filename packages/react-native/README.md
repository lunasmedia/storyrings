# @lunasmedia/storyrings-react-native

Instagram-style stories for React Native and Expo apps: a row of story circles that opens a
full-screen viewer.

```bash
npx expo install @lunasmedia/storyrings-react-native react-native-video @react-native-async-storage/async-storage
# bare React Native: npm install … then cd ios && pod install
```

```tsx
import { StoriesBar } from '@lunasmedia/storyrings-react-native';

<StoriesBar token="pk_live_…" />
```

Your public token is in the Stories dashboard under **Apps & Websites**.

To show stories instantly when the bar first appears, start loading them at app launch:

```tsx
import { startStories } from '@lunasmedia/storyrings-react-native';

startStories({ token: 'pk_live_…' });
```

| Package | Needed for | Without it |
|---|---|---|
| `react-native-video` | Video stories and animated covers | Video stories are skipped; covers show their still image |
| `@react-native-async-storage/async-storage` | Remembering watched stories between launches | Remembered for the current session only |
| `react-native-safe-area-context` (optional) | Exact notch spacing in the viewer | Sensible defaults are used |

Requires React Native 0.79 or newer. Expo apps need a development build (Expo Go doesn't include
the video player).

MIT licensed.
