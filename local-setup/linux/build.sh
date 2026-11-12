#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WORK_VENV="/tmp/mediahunter-build-venv"

if [ ! -f "$ROOT_DIR/companion.py" ]; then
  echo "Error: companion.py not found at $ROOT_DIR/companion.py"
  exit 1
fi

if ! command -v pyinstaller >/dev/null 2>&1; then
  echo "Installing PyInstaller into temporary build venv ($WORK_VENV)..."
  python3 -m venv "$WORK_VENV"
  "$WORK_VENV/bin/pip" install --quiet --upgrade pip pyinstaller
  PYINSTALLER_BIN="$WORK_VENV/bin/pyinstaller"
else
  PYINSTALLER_BIN="$(command -v pyinstaller)"
fi

BUILD_TMP="$(mktemp -d)"
trap 'rm -rf "$BUILD_TMP"' EXIT

"$PYINSTALLER_BIN" \
  --onefile \
  --clean \
  --name mediahunter-companion \
  --distpath "$SCRIPT_DIR" \
  --workpath "$BUILD_TMP/work" \
  --specpath "$BUILD_TMP/spec" \
  "$ROOT_DIR/companion.py"

chmod +x "$SCRIPT_DIR/mediahunter-companion"
echo "Built: $SCRIPT_DIR/mediahunter-companion"

