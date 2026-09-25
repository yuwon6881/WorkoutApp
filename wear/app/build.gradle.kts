plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

val rawWorkoutApiOrigin = providers.gradleProperty("workoutApiOrigin")
    .orElse("https://workout-api-i47taxhzba-as.a.run.app")
    .get()
val workoutApiOrigin = rawWorkoutApiOrigin
    .replace("\\", "\\\\")
    .replace("\"", "\\\"")
val allowCleartextWorkoutApi = rawWorkoutApiOrigin.startsWith("http://", ignoreCase = true)

android {
    namespace = "com.workoutapp.wear"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.workoutapp.wear"
        minSdk = 30
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        buildConfigField("String", "API_BASE_URL", "\"$workoutApiOrigin\"")
    }

    buildTypes {
        getByName("debug") {
            manifestPlaceholders["allowCleartextTraffic"] = allowCleartextWorkoutApi.toString()
        }
        getByName("release") {
            manifestPlaceholders["allowCleartextTraffic"] = "false"
        }
    }

    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    testOptions { unitTests.isIncludeAndroidResources = true }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.06.00"))
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.wear.compose:compose-material3:1.6.2")
    implementation("androidx.wear:wear-ongoing:1.1.0")
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.work:work-runtime-ktx:2.10.5")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.google.code.gson:gson:2.13.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation(platform("androidx.compose:compose-bom:2026.06.00"))
    testImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
