# Stories SDK for Android

Stories for native Android apps: an Instagram-style story bar and full-screen viewer in Jetpack
Compose, with a View wrapper, managed in the Stories dashboard. Integration guide:
[docs/android-sdk.md](../../docs/android-sdk.md).

## Layout

- `core` (`com.stories:core`): pure Kotlin/JVM (viewer state machine, feed parsing, analytics,
  tags, links, gestures, seen state, sessions, and a small JSON reader). It must pass every
  case in `/spec`; see `core/src/test` and `spec/README.md`.
- `sdk` (`com.stories:sdk`): the client, `StoriesBar` (Compose), the viewer, and
  `StoriesBarView`. `ViewerController` holds the viewer's behaviour in plain Kotlin; the
  composables only draw it and feed it touches, frames and media events.

## Development

```sh
./gradlew test   # the behaviour spec, plus the client and viewer controller tests (JVM)
```

The example app (`apps/example-android`) builds the SDK from here through `includeBuild`.

## Publishing

`./gradlew publish` to Maven Central (`com.stories:core`, `com.stories:sdk`), once signing and
the Sonatype account are set up.
