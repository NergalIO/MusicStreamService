pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "0.8.0"
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MusicStreamService"
include(":app")
include(":core:model")
include(":core:network")
include(":core:datastore")
include(":core:connectors")
include(":core:player")
include(":core:downloads")
include(":core:offline")
include(":core:localtracks")
include(":core:lobby")
