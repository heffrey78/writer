plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    compileSdk = 36
    namespace = "io.github.heffrey78.hearspike"
    defaultConfig {
        applicationId = "io.github.heffrey78.hearspike"
        // Audio from a file into the recognizer, and segmented sessions: Android 13.
        minSdk = 33
        targetSdk = 34
        versionCode = 1
        versionName = "0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}
