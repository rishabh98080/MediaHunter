#!/usr/bin/env bash
set -euo pipefail

BIN_NAME="mediahunter-companion"
TARGET_BIN="$HOME/.local/bin/$BIN_NAME"
SERVICE_NAME="mediahunter-companion.service"
SYSTEMD_FILE="$HOME/.config/systemd/user/$SERVICE_NAME"
DESKTOP_FILE="$HOME/.config/autostart/mediahunter-companion.desktop"

echo "== MediaHunter Local Uninstall (Linux) =="

if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
  systemctl --user disable --now "$SERVICE_NAME" >/dev/null 2>&1 || true
  rm -f "$SYSTEMD_FILE"
  systemctl --user daemon-reload >/dev/null 2>&1 || true
fi

pkill -f "$TARGET_BIN" >/dev/null 2>&1 || true
rm -f "$DESKTOP_FILE" "$TARGET_BIN"

echo "Removed MediaHunter Companion startup entry and binary."

