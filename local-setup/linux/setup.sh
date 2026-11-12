#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
INSTALL_DIR="$HOME/.local/bin"
BIN_NAME="mediahunter-companion"
TARGET_BIN="$INSTALL_DIR/$BIN_NAME"
SERVICE_NAME="mediahunter-companion.service"
SYSTEMD_DIR="$HOME/.config/systemd/user"
AUTOSTART_DIR="$HOME/.config/autostart"
DESKTOP_FILE="$AUTOSTART_DIR/mediahunter-companion.desktop"

echo "== MediaHunter Local Setup (Linux) =="

# 1. Ensure yt-dlp is available
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp not found. Attempting installation..."
  if command -v pip3 >/dev/null 2>&1; then
    pip3 install --user --upgrade yt-dlp || true
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m pip install --user --upgrade yt-dlp || true
  elif command -v apt-get >/dev/null 2>&1; then
    echo "Please install yt-dlp and ffmpeg: sudo apt update && sudo apt install -y yt-dlp ffmpeg"
  fi
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "Note: ffmpeg was not found on PATH. Installing ffmpeg is recommended for 1080p+ muxing and MP3 audio."
fi

# 2. Install standalone companion binary (or rebuild if missing)
mkdir -p "$INSTALL_DIR"
if [ -x "$SCRIPT_DIR/$BIN_NAME" ]; then
  cp "$SCRIPT_DIR/$BIN_NAME" "$TARGET_BIN"
  chmod +x "$TARGET_BIN"
elif [ -f "$ROOT_DIR/companion.py" ]; then
  echo "Standalone binary not found alongside setup.sh; creating Python launcher..."
  cat > "$TARGET_BIN" <<EOF
#!/usr/bin/env bash
exec python3 "$ROOT_DIR/companion.py" "\$@"
EOF
  chmod +x "$TARGET_BIN"
else
  echo "Error: Neither $SCRIPT_DIR/$BIN_NAME nor $ROOT_DIR/companion.py was found."
  exit 1
fi

echo "Installed companion to: $TARGET_BIN"

# 3. Configure startup application (systemd user service + XDG desktop autostart)
USE_SYSTEMD=0
if command -v systemctl >/dev/null 2>&1 && systemctl --user status >/dev/null 2>&1; then
  USE_SYSTEMD=1
  mkdir -p "$SYSTEMD_DIR"
  cat > "$SYSTEMD_DIR/$SERVICE_NAME" <<EOF
[Unit]
Description=MediaHunter Local yt-dlp Companion Service
After=network-online.target

[Service]
Type=simple
ExecStart=$TARGET_BIN
Restart=on-failure
RestartSec=3
Environment=PATH=$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable "$SERVICE_NAME"
  systemctl --user restart "$SERVICE_NAME"
  echo "Enabled and started systemd user service: $SERVICE_NAME"
fi

# Always register XDG autostart (with Hidden=true if systemd manages it, or active fallback)
mkdir -p "$AUTOSTART_DIR"
if [ "$USE_SYSTEMD" -eq 1 ]; then
  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=MediaHunter Companion
Comment=Local yt-dlp service for MediaHunter browser extension
Exec=$TARGET_BIN
Terminal=false
Hidden=true
X-GNOME-Autostart-enabled=false
EOF
else
  cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=MediaHunter Companion
Comment=Local yt-dlp service for MediaHunter browser extension
Exec=$TARGET_BIN
Terminal=false
X-GNOME-Autostart-enabled=true
EOF
  pkill -f "$TARGET_BIN" >/dev/null 2>&1 || true
  nohup "$TARGET_BIN" > "${XDG_CACHE_HOME:-$HOME/.cache}/mediahunter-companion.log" 2>&1 &
  echo "Registered desktop autostart ($DESKTOP_FILE) and started companion in background."
fi

# 4. Verify health endpoint
sleep 1
if command -v curl >/dev/null 2>&1 && curl -fsS "http://127.0.0.1:9527/status" >/dev/null 2>&1; then
  echo "MediaHunter Companion is running and healthy at http://127.0.0.1:9527"
else
  echo "Setup complete. Companion is configured for startup; check status at http://127.0.0.1:9527/status"
fi

