plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.vanniktech.maven.publish")
}

android {
    namespace = "com.lunasmedia.storyrings"
    compileSdk = 36

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }

    buildFeatures { compose = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        // Viewer and client logic tests run on the JVM; Android calls return defaults.
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    api(project(":storyrings-core"))
    val compose = platform("androidx.compose:compose-bom:2025.06.00")
    implementation(compose)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.lifecycle:lifecycle-process:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-ui:1.8.0")

    testImplementation("junit:junit:4.13.2")
}

mavenPublishing {
    // Android's Javadoc generation fails on this code, so an empty Javadoc jar is added below instead.
    configure(
        com.vanniktech.maven.publish.AndroidSingleVariantLibrary(
            variant = "release",
            sourcesJar = true,
            publishJavadocJar = false,
        ),
    )
    pom {
        name.set("StoryRings")
        description.set("Instagram-style stories for Android apps: a story bar and full-screen viewer (Jetpack Compose, with a View wrapper).")
    }
}

// Maven Central requires a Javadoc jar; an empty one is accepted.
val emptyJavadocJar by tasks.registering(Jar::class) { archiveClassifier.set("javadoc") }
publishing {
    publications.withType<MavenPublication>().configureEach { artifact(emptyJavadocJar) }
}
