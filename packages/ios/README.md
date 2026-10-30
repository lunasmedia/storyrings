# StoryRings (iOS)

Stories for native iOS apps: an Instagram-style story bar and full-screen viewer in SwiftUI,
with a UIKit view, managed in the Stories dashboard. Integration guide:
[docs/ios-sdk.md](../../docs/ios-sdk.md).

## Layout

- `Sources/StoryRingsCore`: pure Swift (viewer state machine, feed parsing, analytics, tags,
  links, gestures, seen state, sessions). It must pass every case in `/spec`; see
  `Tests/StoryRingsCoreTests` and `spec/README.md`.
- `Sources/StoryRings`: the client, bar, viewer and `StoriesBarView` (UIKit). They only draw
  the core and feed it touches and media events. Includes `PrivacyInfo.xcprivacy`.

## Development

```sh
swift test   # the behaviour spec, on macOS (no simulator needed)
xcodebuild test -scheme StoryRings -destination 'platform=iOS Simulator,name=iPhone 17'
             # the spec plus the client and viewer tests, on iOS
```

## Publishing

Swift Package Manager needs `Package.swift` at the root of a repository, so releases go to a
separate `stories-ios` repository: CI splits this folder out (`git subtree split
--prefix=packages/ios`), pushes it and tags the version (`0.1.0`).
