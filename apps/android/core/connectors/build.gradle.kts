plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.mss.core.connectors"
    compileSdk = 35
    defaultConfig {
        minSdk = 26
        buildConfigField("String", "SPOTIFY_CLIENT_ID", "\"${gradleProp("SPOTIFY_CLIENT_ID", "")}\"")
        // Свой клиент даёт только API Яндекс ID. Музыка входит клиентом Яндекс.Музыки в YandexConnector.
        buildConfigField("String", "YANDEX_CLIENT_ID", "\"${gradleProp("YANDEX_CLIENT_ID", "23cabbbdc6cd418abb4b39c32c41195d")}\"")
        buildConfigField("String", "YANDEX_CLIENT_SECRET", "\"${gradleProp("YANDEX_CLIENT_SECRET", "53bc75238f0c4d08a118e51fe9203300")}\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

val spotifyBridgeSrc = rootProject.projectDir.resolve("../../packages/stream-connectors/src/spotify-page-bridge.inject.js")
val spotifyBridgeDst = file("src/main/assets/spotify-page-bridge.inject.js")

tasks.register("syncSpotifyPageBridge") {
    inputs.file(spotifyBridgeSrc)
    outputs.file(spotifyBridgeDst)
    doLast {
        if (!spotifyBridgeSrc.exists()) return@doLast
        spotifyBridgeDst.parentFile.mkdirs()
        spotifyBridgeSrc.copyTo(spotifyBridgeDst, overwrite = true)
    }
}

afterEvaluate {
    tasks.findByName("preBuild")?.dependsOn("syncSpotifyPageBridge")
}

fun gradleProp(name: String, fallback: String): String {
    val value = (project.findProperty(name) as? String)?.trim().orEmpty()
    return value.ifBlank { fallback }
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:datastore"))
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.okhttp)
    implementation(libs.ktor.client.content)
    implementation(libs.ktor.serialization.json)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.browser)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
    testImplementation(libs.junit)
}
