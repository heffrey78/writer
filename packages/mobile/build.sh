#!/usr/bin/env bash
# Builds Writer's Android app (#52): the web app, then a debug-signed APK for `target` (aarch64, a
# phone; x86_64, the emulator), with the tools env.sh names. Unity's SDK carries no accepted
# licences, so Gradle can't fetch anything missing: the generated project is pointed at platform 36,
# which the SDK has, and targets 34.
set -euo pipefail
target="${1:-aarch64}"
cd "$(dirname "${BASH_SOURCE[0]}")"
source env.sh
(cd ../.. && npm run build)
tauri=(node "$(realpath ../../node_modules/@tauri-apps/cli/tauri.js)")
cd src-tauri
[[ -d gen/android ]] || "${tauri[@]}" android init --ci
sed -i -E 's/compileSdk = [0-9]+/compileSdk = 36/; s/targetSdk = [0-9]+/targetSdk = 34/' gen/android/app/build.gradle.kts
# Gradle runs `node tauri …` from src-tauri, where there's no "tauri": give it the CLI's script.
sed -i "s|listOf(\"tauri\", \"android\", \"android-studio-script\")|listOf(\"${tauri[1]}\", \"android\", \"android-studio-script\")|" gen/android/buildSrc/src/main/java/io/github/heffrey78/writer/kotlin/BuildTask.kt
# An APK of the last build would be taken for this one's.
rm -rf gen/android/app/build/outputs/apk
"${tauri[@]}" android build --debug --apk --target "$target"
find gen/android/app/build/outputs/apk -name '*.apk'
