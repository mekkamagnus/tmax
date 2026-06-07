#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BINARIES=("tmax" "tlisp")

if [ ! -f "$ROOT/dist/tmax" ] || [ ! -f "$ROOT/dist/tlisp" ]; then
  echo "Building..."
  bun run build
fi

for name in "${BINARIES[@]}"; do
  TARGET="/usr/local/bin/$name"
  SOURCE="$ROOT/dist/$name"
  if [ -L "$TARGET" ]; then
    echo "Symlink already exists: $TARGET -> $(readlink "$TARGET")"
  else
    ln -sf "$SOURCE" "$TARGET"
    echo "Created symlink: $TARGET -> $SOURCE"
  fi
done
