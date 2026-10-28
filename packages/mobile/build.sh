#!/usr/bin/env bash
# Builds Writer's Android app (#52): the web app, then a debug-signed APK for `target` (aarch64, a
# phone; x86_64, the emulator), with the tools env.sh names. Unity's SDK carries no accepted
# licences, so Gradle can't fetch anything missing: the generated project is pointed at platform 36,
# which the SDK has, and targets 34.
set -euo pipefail
target="${1:-aarch64}"
cd "$(dirname "${BASH_SOURCE[0]}")"
source env.sh
# OpenSSL's build (git2-port's vendored-openssl) asks the cc crate for a ranlib, which finds none
# named for Android, and falls back to an llvm-ranlib on the PATH: there here, not on CI (#105).
# The NDK's own, for both targets.
ndk_bin="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin"
export RANLIB_aarch64_linux_android="$ndk_bin/llvm-ranlib" RANLIB_x86_64_linux_android="$ndk_bin/llvm-ranlib"
(cd ../.. && npm run build)
tauri=(node "$(realpath ../../node_modules/@tauri-apps/cli/tauri.js)")
cd src-tauri
[[ -d gen/android ]] || "${tauri[@]}" android init --ci
# Android 8 (API 26) at least: dictation hears through AAudio (#86).
sed -i -E 's/compileSdk = [0-9]+/compileSdk = 36/; s/targetSdk = [0-9]+/targetSdk = 34/; s/minSdk = [0-9]+/minSdk = 26/' gen/android/app/build.gradle.kts
# Gradle runs `node tauri …` from src-tauri, where there's no "tauri": give it the CLI's script.
sed -i "s|listOf(\"tauri\", \"android\", \"android-studio-script\")|listOf(\"${tauri[1]}\", \"android\", \"android-studio-script\")|" gen/android/buildSrc/src/main/java/io/github/heffrey78/writer/kotlin/BuildTask.kt
# sherpa-onnx's build copies all its Android libraries into jniLibs (dictation, #86): the app needs
# the C API's and ONNX Runtime's, not the JNI's or the C++ API's (4.8 MB).
grep -q 'libsherpa-onnx-jni.so' gen/android/app/build.gradle.kts || cat >> gen/android/app/build.gradle.kts <<'GRADLE'

android { packaging { jniLibs { excludes += listOf("**/libsherpa-onnx-jni.so", "**/libsherpa-onnx-cxx-api.so") } } }
GRADLE
# The debug key from WRITER_ANDROID_DEBUG_KEYSTORE where it's set (CI, #105), so the APK installs over
# the phone's app: Gradle's default place for it isn't ~/.android on every machine (on GitHub's
# runners it signed with a key of its own). Unset, Gradle's own debug key, as here.
grep -q 'WRITER_ANDROID_DEBUG_KEYSTORE' gen/android/app/build.gradle.kts || cat >> gen/android/app/build.gradle.kts <<'GRADLE'

android { signingConfigs { getByName("debug") { System.getenv("WRITER_ANDROID_DEBUG_KEYSTORE")?.let { storeFile = file(it) } } } }
GRADLE
# An APK of the last build would be taken for this one's.
rm -rf gen/android/app/build/outputs/apk
"${tauri[@]}" android build --debug --apk --target "$target"
find gen/android/app/build/outputs/apk -name '*.apk'
