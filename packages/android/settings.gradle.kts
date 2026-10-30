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

rootProject.name = "stories-android"

// Pure Kotlin, no Android: must pass every case in /spec (core/src/test).
include(":core")
// The story bar and viewer (Jetpack Compose, with an Android View wrapper).
include(":sdk")
