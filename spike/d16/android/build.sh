#!/usr/bin/env bash
# Builds the D16 spike's APK (arm64, debug-signed) with Unity's Android SDK, NDK and JDK (env.sh).
# Unity's SDK carries no accepted licences, so Gradle can't fetch anything missing: the generated
# project is pointed at platform 36, which the SDK has, and targets 34, as Quest apps do.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
source env.sh
tauri=(node "$(realpath ../../../node_modules/@tauri-apps/cli/tauri.js)")
[[ -d src-tauri/gen/android ]] || "${tauri[@]}" android init --ci
sed -i -E 's/compileSdk = [0-9]+/compileSdk = 36/; s/targetSdk = [0-9]+/targetSdk = 34/' src-tauri/gen/android/app/build.gradle.kts
# Gradle runs `node tauri …` from src-tauri, where there's no "tauri": give it the CLI's script.
sed -i "s|listOf(\"tauri\", \"android\", \"android-studio-script\")|listOf(\"${tauri[1]}\", \"android\", \"android-studio-script\")|" src-tauri/gen/android/buildSrc/src/main/java/io/github/heffrey78/writer/d16/kotlin/BuildTask.kt
"${tauri[@]}" android build --debug --apk --target aarch64
