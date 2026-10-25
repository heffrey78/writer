#!/usr/bin/env bash
# The speech models the spike compares, into models/ (not committed). Each is fetched once.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p models lib
SHERPA=https://github.com/k2-fsa/sherpa-onnx/releases/download
get() { # url, then the folder or file it gives
  [[ -e "models/$2" ]] && return
  echo "fetching $2"
  case "$1" in
    *.tar.bz2) curl -sSL "$1" | tar xj -C models ;;
    *.zip) curl -sSL -o "models/$2.zip" "$1" && (cd models && unzip -q "$2.zip" && rm "$2.zip") ;;
    *) curl -sSL -o "models/$2" "$1" ;;
  esac
}
get $SHERPA/asr-models/silero_vad.onnx silero_vad.onnx
get $SHERPA/punctuation-models/sherpa-onnx-online-punct-en-2024-08-06.tar.bz2 sherpa-onnx-online-punct-en-2024-08-06
get $SHERPA/asr-models/sherpa-onnx-streaming-zipformer-en-2023-06-26.tar.bz2 sherpa-onnx-streaming-zipformer-en-2023-06-26
get $SHERPA/asr-models/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06.tar.bz2 sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06
get $SHERPA/asr-models/sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8.tar.bz2 sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8
get $SHERPA/asr-models/sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25.tar.bz2 sherpa-onnx-nemotron-speech-streaming-en-0.6b-560ms-int8-2026-04-25
get $SHERPA/asr-models/sherpa-onnx-moonshine-base-en-quantized-2026-02-27.tar.bz2 sherpa-onnx-moonshine-base-en-quantized-2026-02-27
get $SHERPA/asr-models/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27.tar.bz2 sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27
get $SHERPA/asr-models/sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8.tar.bz2 sherpa-onnx-nemo-parakeet_tdt_transducer_110m-en-36000-int8
get https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin ggml-base.en.bin
get https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin ggml-small.en.bin
get https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip vosk-model-small-en-us-0.15
# Vosk's own library, which its crate links against.
if [[ ! -e lib/libvosk.so ]]; then
  curl -sSL -o lib/vosk.zip https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-linux-x86_64-0.3.45.zip
  (cd lib && unzip -q -j vosk.zip '*/libvosk.so' '*/vosk_api.h' && rm vosk.zip)
fi
du -sh models/* lib
