#!/usr/bin/env bash
# Generate PWA icons from a single square source PNG (>=512px, the blue rounded-square "P" logo).
# Usage: bash scripts/gen-icons.sh icons/logo-src.png
set -euo pipefail
SRC="${1:-icons/logo-src.png}"
cd "$(dirname "$0")/.."
[ -f "$SRC" ] || { echo "Source not found: $SRC"; exit 1; }

cp "$SRC" icons/icon-512.png
sips -z 512 512 icons/icon-512.png >/dev/null
sips -s format png -z 192 192 "$SRC" --out icons/icon-192.png >/dev/null

echo "Done:"
sips -g pixelWidth -g pixelHeight icons/icon-192.png icons/icon-512.png 2>/dev/null | grep -E "pixel|icons"
