#!/usr/bin/env bash
# The leading engines on the attached phone, over adb: no app, the bench run as a program in
# /data/local/tmp, with the same models and clips as on this computer. Results come back to
# results/phone.jsonl.
#
#   ./phone.sh                 build for the phone, push, run
#   ENGINES="parakeet-110m+zipformer" THREADS="1 2 4" ./phone.sh
#   ONLY=android ./phone.sh    Android's own recognizer only
set -euo pipefail
cd "$(dirname "$0")"
ADB="${ADB:-$HOME/.local/share/writer-android/platform-tools/adb}"
on=/data/local/tmp/hear
engines=(${ENGINES:-zipformer+punct kroko+punct moonshine-tiny moonshine-base parakeet-110m parakeet-110m+zipformer moonshine-base+zipformer})
threads=(${THREADS:-1 2})

device=$("$ADB" shell getprop ro.product.model | tr -d '\r')
if [[ "${ONLY:-}" != android ]]; then
# Built with the app's Android toolchain, 16 KB pages as the app's library is.
(
  cd hear
  source ../../../packages/mobile/env.sh
  export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/bin/aarch64-linux-android26-clang"
  export CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS="-C link-arg=-Wl,-z,max-page-size=16384"
  cargo build -q --release --bin bench --no-default-features --features sherpa-shared --target aarch64-linux-android --target-dir target-android
)

"$ADB" shell mkdir -p $on/models $on/clips $on/results
"$ADB" push -q hear/target-android/aarch64-linux-android/release/bench lib/android/jniLibs/arm64-v8a/libsherpa-onnx-c-api.so lib/android/jniLibs/arm64-v8a/libonnxruntime.so $on/
"$ADB" push -q models/silero_vad.onnx $on/models/
# Each model's own folder, without its test recordings or the full-precision copies it isn't run with.
for d in sherpa-onnx-streaming-zipformer-en-2023-06-26 sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06 sherpa-onnx-online-punct-en-2024-08-06 \
  sherpa-onnx-moonshine-base-en-quantized-2026-02-27 sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27 sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8; do
  if ! "$ADB" shell test -d $on/models/$d; then
    "$ADB" shell mkdir -p $on/models/$d
    for f in models/$d/*; do
      case "$f" in *test_wavs|*-128.onnx|*/model.onnx) continue ;; esac
      "$ADB" push -q "$f" $on/models/$d/
    done
  fi
done
"$ADB" push -q clips/*.wav clips/*.json $on/clips/

"$ADB" shell rm -f $on/results/runs.jsonl
for clip in clips/*.json; do
  clip=$(basename "$clip" .json)
  for t in "${threads[@]}"; do
    for engine in "${engines[@]}"; do
      echo "$engine on $clip, $t thread(s), on the $device" >&2
      "$ADB" shell "cd $on && HEAR_DIR=$on HEAR_DEVICE='$device' LD_LIBRARY_PATH=$on ./bench '$engine' '$clip' $t > /dev/null 2>&1" || echo "  failed" >&2
    done
  done
done
"$ADB" pull -q $on/results/runs.jsonl results/phone-run.jsonl
cat results/phone-run.jsonl >> results/phone.jsonl && rm results/phone-run.jsonl
fi

# Android's own on-device recognizer, on the same clips at speaking pace (recognizer/), scored here.
app=io.github.heffrey78.hearspike
files=/sdcard/Android/data/$app/files
(cd recognizer && source ../../../packages/mobile/env.sh && echo "sdk.dir=$ANDROID_HOME" > local.properties && ./gradlew -q assembleDebug)
"$ADB" install -r -g recognizer/app/build/outputs/apk/debug/app-debug.apk > /dev/null
"$ADB" shell mkdir -p $files
for clip in clips/*.json; do
  clip=$(basename "$clip" .json)
  echo "Android's recognizer on $clip, on the $device: keep the phone's screen on and Writer's scratch app in front" >&2
  "$ADB" push -q "clips/$clip.wav" $files/
  "$ADB" shell rm -f $files/$clip.events.jsonl
  "$ADB" shell am start -S -n $app/.MainActivity --es clip "$clip" > /dev/null
  # The clip's length at speaking pace, and a minute and a half more: then what it heard so far.
  limit=$(( $(python3 -c "import json; print(int(json.load(open('clips/$clip.json'))['seconds']))") + 90 ))
  waited=0
  until "$ADB" shell "grep -q '\"done\"' $files/$clip.events.jsonl 2>/dev/null"; do
    sleep 5
    waited=$((waited + 5))
    if (( waited > limit )); then
      echo "  no end from the recognizer after ${waited} s: scoring what it heard" >&2
      break
    fi
  done
  "$ADB" pull -q $files/$clip.events.jsonl "results/$clip.android.events.jsonl"
  HEAR_DEVICE="$device" hear/target/release/bench --events "results/$clip.android.events.jsonl" "$clip" android-on-device | tail -1 >> results/phone.jsonl
  # The bench logs every run; this one belongs with the phone's.
  sed -i '$d' results/runs.jsonl
done
echo "results/phone.jsonl: $(wc -l < results/phone.jsonl) runs" >&2
