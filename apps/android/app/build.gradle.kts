plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.hilt)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.mss.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.mss.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    signingConfigs {
        create("release") {
            val file = System.getenv("MSS_KEYSTORE")
            val storePass = System.getenv("MSS_KEYSTORE_PASSWORD")
            val alias = System.getenv("MSS_KEY_ALIAS")
            val keyPass = System.getenv("MSS_KEY_PASSWORD")
            val configured = !file.isNullOrBlank() && !storePass.isNullOrBlank() && !alias.isNullOrBlank()
            if (System.getenv("MSS_REQUIRE_RELEASE_SIGNING") == "1" && !configured) {
                error("Release signing required: set MSS_KEYSTORE, MSS_KEYSTORE_PASSWORD, MSS_KEY_ALIAS")
            }
            if (configured) {
                storeFile = file(file)
                storePassword = storePass
                keyAlias = alias
                keyPassword = keyPass ?: storePass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")?.takeIf { it.storeFile != null }
                ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    lint {
        warning += "Instantiatable"
    }
}

dependencies {
    implementation(project(":core:model"))
    implementation(project(":core:network"))
    implementation(project(":core:datastore"))
    implementation(project(":core:connectors"))
    implementation(project(":core:player"))
    implementation(project(":core:downloads"))
    implementation(project(":core:offline"))
    implementation(project(":core:localtracks"))
    implementation(project(":core:lobby"))

    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime)
    implementation(libs.androidx.lifecycle.viewmodel)
    implementation(libs.androidx.navigation.compose)
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material)
    implementation(libs.compose.material.icons)
    implementation(libs.browser)
    implementation(libs.coil.compose)
    implementation(libs.work.runtime)
    implementation(libs.hilt.work)
    implementation("androidx.startup:startup-runtime:1.2.0")
    implementation(libs.hilt.android)
    implementation(libs.hilt.navigation.compose)
    implementation(libs.kotlinx.coroutines.android)
    ksp(libs.hilt.compiler)
    ksp(libs.hilt.androidx.compiler)

    testImplementation(libs.junit)
    debugImplementation(libs.compose.ui.tooling)
}
