# StoryRings SDKs

Instagram-style stories for websites and mobile apps, managed in the StoryRings dashboard: a row
of story circles that opens a full-screen viewer with progress bars, swipes, video, buttons and
polls.

| Platform | Install | Guide |
|---|---|---|
| Website | `npm install @lunasmedia/storyrings-web` | [docs/web-sdk.md](docs/web-sdk.md) |
| React | `npm install @lunasmedia/storyrings-react` | [docs/web-sdk.md#react](docs/web-sdk.md#react) |
| React Native / Expo | `npx expo install @lunasmedia/storyrings-react-native react-native-video @react-native-async-storage/async-storage` | [docs/react-native-sdk.md](docs/react-native-sdk.md) |
| iOS (SwiftUI / UIKit) | Swift Package Manager: `https://github.com/lunasmedia/storyrings` | [docs/ios-sdk.md](docs/ios-sdk.md) |
| Android (Compose / Views) | Coming soon | [docs/android-sdk.md](docs/android-sdk.md) |
| Flutter | Coming soon | [docs/flutter-sdk.md](docs/flutter-sdk.md) |

Each app or website gets a public token (`pk_live_…`) in the dashboard under
**Apps & Websites**.

## Repository

| Folder | What |
|---|---|
| `packages/web`, `packages/react`, `packages/react-native` | The npm packages |
| `packages/core`, `packages/contracts` | Shared TypeScript logic and API types, bundled into the npm packages |
| `packages/ios` | iOS SDK (built from `Package.swift` at the top of the repository) |
| `packages/android` | Android SDK |
| `packages/flutter` | Flutter SDK |
| `spec` | Test cases every SDK must pass, so they all behave the same |

```bash
pnpm install && pnpm build && pnpm test   # Web, React, React Native
swift build                               # iOS
cd packages/android && ./gradlew test     # Android
cd packages/flutter && flutter test       # Flutter
```

## License

MIT
