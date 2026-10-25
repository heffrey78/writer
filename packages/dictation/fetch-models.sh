#!/usr/bin/env bash
# The speech model for the tests, into models/ (not committed): each source downloaded once into
# models/downloads/, then installed by the crate's own `install`, as a host would.
set -euo pipefail
cd "$(dirname "$0")"
dir="${1:-models}"
# Already whole (CI's cache): nothing to fetch.
cargo run -q --release --example install -- "$dir" 2> /dev/null && exit 0
mkdir -p "$dir/downloads"
urls=$(sed -n 's/^ *url: "\(https[^"]*\)",$/\1/p' src/model.rs)
files=()
for url in $urls; do
  out="$dir/downloads/$(basename "$url")"
  [[ -s "$out" ]] || curl -sSfL --retry 3 -o "$out" "$url"
  files+=("$out")
done
cargo run -q --release --example install -- "$dir" "${files[@]}"
