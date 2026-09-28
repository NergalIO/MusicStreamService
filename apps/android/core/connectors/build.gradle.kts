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
        buildConfigField("String", "SPOTIFY_CLIENT_ID", "\"${project.findProperty("SPOTIFY_CLIENT_ID") ?: ""}\"")
        buildConfigField("String", "YANDEX_CLIENT_ID", "\"${project.findProperty("YANDEX_CLIENT_ID") ?: "23cabbbdc6cd418abb4b39c32c41195d"}\"")
        buildConfigField("String", "YANDEX_CLIENT_SECRET", "\"${project.findProperty("YANDEX_CLIENT_SECRET") ?: "53bc75238f0c4d08a118e51fe9203300"}\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
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
