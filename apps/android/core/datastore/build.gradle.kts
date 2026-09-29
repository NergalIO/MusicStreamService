import java.util.Properties

plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

val localProps = Properties().apply {
    val f = rootProject.file("local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

fun gradleProp(name: String): String {
    val fromProject = (project.findProperty(name) as? String)?.trim().orEmpty()
    if (fromProject.isNotEmpty()) return fromProject
    return localProps.getProperty(name)?.trim().orEmpty()
}

fun gradleStringLiteral(value: String): String =
    value.replace("\\", "\\\\").replace("\"", "\\\"")

android {
    namespace = "com.mss.core.datastore"
    compileSdk = 35
    defaultConfig {
        minSdk = 26
        val apiPublic = gradleProp("API_PUBLIC_URL").trimEnd('/')
        buildConfigField("String", "BAKED_API_PUBLIC_URL", "\"${gradleStringLiteral(apiPublic)}\"")
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
    implementation(libs.datastore.preferences)
    implementation(libs.security.crypto)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.hilt.android)
    ksp(libs.hilt.compiler)
}
