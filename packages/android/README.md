# StoryRings for Android

Stories for native Android apps: an Instagram-style story bar and full-screen viewer in Jetpack
Compose, with a View wrapper, managed in the Stories dashboard. Integration guide:
[docs/android-sdk.md](../../docs/android-sdk.md).

## Layout

- `core` (`io.github.brad-jeancy:storyrings-core`): pure Kotlin/JVM (viewer state machine, feed parsing, analytics,
  tags, links, gestures, seen state, sessions, and a small JSON reader). It must pass every
  case in `/spec`; see `core/src/test` and `spec/README.md`.
- `sdk` (`io.github.brad-jeancy:storyrings-android`): the client, `StoriesBar` (Compose), the viewer, and
  `StoriesBarView`. `ViewerController` holds the viewer's behaviour in plain Kotlin; the
  composables only draw it and feed it touches, frames and media events.

## Development

```sh
./gradlew test   # the behaviour spec, plus the client and viewer controller tests (JVM)
```

The example app (`apps/example-android`) builds the SDK from here through `includeBuild`.

## Publishing

Maven Central, namespace `io.github.brad-jeancy` (central.sonatype.com). Run `./setup-signing.sh`
once to create the signing key, then add the Central Portal user token. Both live in
`~/.gradle/gradle.properties`, never in this repository:

```properties
mavenCentralUsername=…
mavenCentralPassword=…
signingInMemoryKey=…            # the armored private key, on one line (newlines as \n)
signingInMemoryKeyPassword=…
```

Then set `version` in `build.gradle.kts` and run:

```sh
./gradlew publishToMavenCentral   # uploads both modules; release them at central.sonatype.com
./gradlew publishToMavenLocal     # unsigned, into ~/.m2, to check before uploading
```
