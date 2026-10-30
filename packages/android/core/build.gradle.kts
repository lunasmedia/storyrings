plugins {
    id("org.jetbrains.kotlin.jvm")
    id("com.vanniktech.maven.publish")
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

kotlin {
    compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) }
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

tasks.test {
    // The spec lives at the repository root.
    systemProperty("stories.spec", rootProject.file("../../spec").absolutePath)
    testLogging { events("failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}

mavenPublishing {
    pom {
        name.set("StoryRings Core")
        description.set("Shared logic for the StoryRings Android SDK: feed, viewer state and analytics.")
    }
}
