#!/usr/bin/env bash
# Installs the APK build.sh made last on the attached phone, keeping the app's data, and opens it.
# With more than one device attached, the phone is preferred to an emulator; ANDROID_SERIAL picks one.
# ADB names adb, if it isn't on PATH.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
adb="${ADB:-adb}"
apk="$(find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' 2>/dev/null | head -n 1)"
if [[ -z "$apk" ]]; then
  echo "No APK yet: run npm run android first." >&2
  exit 1
fi
if [[ -z "${ANDROID_SERIAL:-}" ]]; then
  devices="$("$adb" devices | awk 'NR > 1 && $2 == "device" { print $1 }')"
  if [[ -z "$devices" ]]; then
    echo "No device found: plug in the phone, unlock it and allow USB debugging, then check adb devices." >&2
    exit 1
  fi
  export ANDROID_SERIAL="$(grep -v '^emulator-' <<<"$devices" | head -n 1 || true)"
  [[ -n "$ANDROID_SERIAL" ]] || ANDROID_SERIAL="$(head -n 1 <<<"$devices")"
fi
echo "Installing $apk on $("$adb" shell getprop ro.product.model | tr -d '\r') ($ANDROID_SERIAL)"
"$adb" install -r "$apk"
"$adb" shell monkey -p io.github.heffrey78.writer -c android.intent.category.LAUNCHER 1 >/dev/null
