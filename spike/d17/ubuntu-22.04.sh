#!/usr/bin/env bash
# Does the speech engine build where the desktop's .deb is built (Ubuntu 22.04, its glibc 2.35),
# and run there? Builds hear/ in a container and runs the leading engine on one passage.
set -euo pipefail
cd "$(dirname "$0")"
docker run --rm -v "$PWD:/spike" -w /spike/hear ubuntu:22.04 bash -c '
  set -e
  apt-get update -qq && apt-get install -y -qq curl build-essential pkg-config > /dev/null
  curl -sSf https://sh.rustup.rs | sh -s -- -y -q --profile minimal > /dev/null
  . "$HOME/.cargo/env"
  ldd --version | head -1
  CARGO_TARGET_DIR=/tmp/target cargo build -q --release --bin bench
  /tmp/target/release/bench parakeet-110m+zipformer librispeech-test-clean 1 | cut -c1-200
'
