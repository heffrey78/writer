#!/usr/bin/env bash
# Every engine on every passage in clips/, one process each (so each run's memory is its own), on
# THREADS threads (2 by default). Results go to results/runs.jsonl.
set -euo pipefail
cd "$(dirname "$0")"
threads="${THREADS:-2}"
engines=("${@:-zipformer zipformer+punct kroko+punct fastconformer fastconformer+punct nemotron moonshine-tiny moonshine-base parakeet-110m whisper-base whisper-small vosk-small}")
# whisper.cpp and Vosk have binaries of their own (they crash beside sherpa-onnx's static build).
bench() {
  case "$1" in
    whisper*) echo hear/target-whisper/release/bench ;;
    vosk*) echo hear/target-vosk/release/bench ;;
    *) echo hear/target/release/bench ;;
  esac
}
for clip in ${CLIPS:-clips/*.json}; do
  clip=$(basename "$clip" .json)
  for engine in ${engines[@]}; do
    echo "$engine on $clip" >&2
    "$(bench "$engine")" "$engine" "$clip" "$threads" > /dev/null 2> >(grep -v "^$" | tail -2 >&2) || echo "  failed" >&2
  done
done
