plugins {
    id("com.android.library") version "8.12.0" apply false
    id("org.jetbrains.kotlin.android") version "2.1.20" apply false
    id("org.jetbrains.kotlin.jvm") version "2.1.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.1.20" apply false
    id("com.vanniktech.maven.publish") version "0.34.0" apply false
}

allprojects {
    group = "io.github.brad-jeancy"
    version = "0.1.0"
}

// Maven Central: ./gradlew publishToMavenCentral (see README.md). Both modules share this POM.
subprojects {
    plugins.withId("com.vanniktech.maven.publish") {
        extensions.configure<com.vanniktech.maven.publish.MavenPublishBaseExtension> {
            publishToMavenCentral()
            // Signed when the key is set up (~/.gradle/gradle.properties); local test builds aren't.
            if (providers.gradleProperty("signingInMemoryKey").isPresent) signAllPublications()
            pom {
                url.set("https://github.com/lunasmedia/storyrings")
                inceptionYear.set("2026")
                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }
                developers {
                    developer {
                        id.set("brad-jeancy")
                        name.set("Lunasmedia")
                        url.set("https://github.com/lunasmedia")
                    }
                }
                scm {
                    url.set("https://github.com/lunasmedia/storyrings")
                    connection.set("scm:git:https://github.com/lunasmedia/storyrings.git")
                    developerConnection.set("scm:git:ssh://git@github.com/lunasmedia/storyrings.git")
                }
            }
        }
    }
}
