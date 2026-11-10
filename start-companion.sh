#!/usr/bin/env bash
# MediaHunter yt-dlp Companion Starter Script

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=9527

# Check if yt-dlp is installed
if ! command -v yt-dlp &> /dev/null; then
    echo "❌ Error: yt-dlp is not installed or not in PATH."
    echo "Please install yt-dlp: sudo apt install yt-dlp  OR  pip install yt-dlp"
    exit 1
fi

# Check if already running
if curl -s "http://127.0.0.1:${PORT}/status" | grep -q "ok"; then
    echo "✅ MediaHunter Companion is already running on http://127.0.0.1:${PORT}"
    exit 0
fi

echo "🚀 Starting MediaHunter yt-dlp Companion on http://127.0.0.1:${PORT}..."
nohup python3 "$DIR/companion.py" > "$DIR/companion.log" 2>&1 &
PID=$!

sleep 1
if curl -s "http://127.0.0.1:${PORT}/status" | grep -q "ok"; then
    echo "✅ MediaHunter Companion started successfully (PID: $PID) on http://127.0.0.1:${PORT}"
else
    echo "⚠️ Started process $PID, check companion.log for details."
fi

