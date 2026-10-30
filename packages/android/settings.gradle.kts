pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "storyrings"

// Pure Kotlin, no Android: must pass every case in /spec (core/src/test).
// Project names are the Maven artifacts: io.github.brad-jeancy:storyrings-core.
include(":storyrings-core")
project(":storyrings-core").projectDir = file("core")
// The story bar and viewer (Jetpack Compose, with an Android View wrapper).
// io.github.brad-jeancy:storyrings-android
include(":storyrings-android")
project(":storyrings-android").projectDir = file("sdk")
