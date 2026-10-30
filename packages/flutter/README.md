# stories_sdk

Stories for Flutter apps: an Instagram-style story bar and full-screen viewer, managed in the
Stories dashboard. Integration guide: [docs/flutter-sdk.md](../../docs/flutter-sdk.md).

## Development

```sh
flutter pub get
flutter test      # the behaviour spec (spec/) plus widget tests
flutter analyze
```

`lib/stories_core.dart` is the pure-Dart core (viewer state machine, feed parsing, analytics,
tags, links, gestures, seen state, sessions). It must pass every case in `/spec`: see
`test/conformance_test.dart` and `spec/README.md`. The widgets in `lib/src/widgets` only draw
it and feed it taps and media events.
