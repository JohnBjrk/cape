#!/bin/sh
# Local install fixture for container tests.
# Installs the cape binary from a mounted /release directory
# instead of downloading from GitHub — identical logic to install.sh
# but reads from the filesystem.
set -e

NAME="cape"
RELEASE_DIR="/release"

ARCH="$(uname -m)"
case "$ARCH" in
  x86_64)        ARCH="x64"   ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)
    echo "Unsupported arch: $ARCH" >&2
    exit 1
    ;;
esac

ASSET="${NAME}-linux-${ARCH}.gz"
SRC="${RELEASE_DIR}/${ASSET}"

if [ ! -f "$SRC" ]; then
  echo "Error: $SRC not found in release dir" >&2
  echo "Contents of $RELEASE_DIR:" >&2
  ls "$RELEASE_DIR" >&2
  exit 1
fi

TMP="$(mktemp)"
gunzip -c "$SRC" > "$TMP"
chmod +x "$TMP"

BIN_DIR="$HOME/.${NAME}/bin"
mkdir -p "$BIN_DIR"
mv "$TMP" "${BIN_DIR}/${NAME}"

echo "Installed ${NAME} to ${BIN_DIR}/${NAME}"
