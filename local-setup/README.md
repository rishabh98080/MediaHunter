# MediaHunter Local Companion Setup

This folder contains the standalone local companion and initial setup scripts so MediaHunter's `yt-dlp` service (`http://127.0.0.1:9527`) starts automatically when you log in — no manual script running needed after setup.

## Structure

- `companion.py` — Cross-platform `yt-dlp` companion HTTP service.
- `linux/`
  - `mediahunter-companion` — Standalone compiled Linux binary.
  - `setup.sh` — Installs `mediahunter-companion` to `~/.local/bin/`, enables it as a startup application (`systemd --user` service, or XDG autostart `~/.config/autostart/mediahunter-companion.desktop`), and starts it immediately.
  - `uninstall.sh` — Stops the companion and removes startup registration.
  - `build.sh` — Rebuilds `mediahunter-companion` from `companion.py` on Linux.
- `windows/`
  - `setup.bat` — Installs `yt-dlp` if missing (via `winget` or `pip`), installs `mediahunter-companion.exe` (or `companion.py` + `pythonw.exe` fallback), registers it under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` for automatic startup on login, and starts it immediately.
  - `uninstall.bat` — Stops the companion and removes the Windows startup entry.
  - `build-exe.bat` — Builds `mediahunter-companion.exe` on Windows using PyInstaller (`--onefile --noconsole`).

## Usage

### Linux (Ubuntu / Desktop)
```bash
cd local-setup/linux
chmod +x setup.sh uninstall.sh build.sh
./setup.sh
```

### Windows
1. *(Optional, to build a standalone `.exe`)* Run `local-setup\windows\build-exe.bat` on Windows (requires Python 3).
2. Run `local-setup\windows\setup.bat` once. It registers MediaHunter Companion to run automatically on login and starts it in the background.

> **Note:** On a Linux host without a Windows cross-compilation toolchain (`mingw-w64` / Windows Python), `mediahunter-companion.exe` cannot be compiled natively on Linux and must be built on Windows using `build-exe.bat` (or `setup.bat` will automatically run `companion.py` silently via `pythonw.exe` if Python is installed).

