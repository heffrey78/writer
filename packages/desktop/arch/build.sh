#!/bin/sh
# Build the Arch package from the desktop app's .deb (see PKGBUILD): built here, or given as WRITER_DEB.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
version=$(sed -n 's/^pkgver=//p' "$here/PKGBUILD")
release=$(sed -n 's/^pkgrel=//p' "$here/PKGBUILD")
# WRITER_DEB: a .deb already built (CI builds it on Ubuntu, then repackages it here on Arch).
if [ -n "${WRITER_DEB:-}" ]; then
  cp "$WRITER_DEB" "$here/writer_${version}_amd64.deb"
else
  cd "$here/.."
  npx tauri build --bundles deb
  ln -sf "../src-tauri/target/release/bundle/deb/writer_${version}_amd64.deb" "$here/"
fi
cd "$here"
# --nodeps: only the binaries are repackaged; pacman checks the dependencies when it installs.
makepkg --force --cleanbuild --nodeps

# The installer budget (#169): 100 MB.
size=$(stat -c %s "$here/writer-$version-$release-x86_64.pkg.tar.zst")
if [ "$size" -gt 100000000 ]; then
  echo "The package is $((size / 1000000)) MB, over the 100 MB budget." >&2
  exit 1
fi
echo "Package: $((size / 1000000)) MB"
