# MediaHunter 🎬🔍

<p align="center">
  <img src="icons/icon128.png" alt="MediaHunter Logo" width="100" />
</p>

<p align="center">
  <strong>Next-Generation Media Discovery & Download Suite for Chrome</strong>
</p>

<p align="center">
  <a href="#-quick-setup">Quick Setup</a> •
  <a href="#-features">Features</a> •
  <a href="#-installation-guide">Installation</a> •
  <a href="#-local-companion-setup-multi-quality-yt-dlp">Local Setup</a> •
  <a href="#-support">Support</a>
</p>

---

## 🚀 Quick Setup

* 🌐 **Chrome Extension:** Clone or download this repository as a ZIP from GitHub and load it unpacked in `chrome://extensions/`.
* 🛠️ **Local Companion ([`local-setup/`](local-setup/)):** One-time setup script for automatic `yt-dlp` startup on **Linux (Ubuntu)** and **Windows**.

---

## ✨ Features

* **Apple-Inspired Dark Gray Glass UI**: Sleek dark gray glassmorphism design with violet accents (`#6946fb`), responsive preview drawer, and clean typography.
* **Smart Multi-Quality Video Extraction (`yt-dlp` Companion)**: Automatically surfaces `1080p`, `720p`, `480p`, `360p`, and `MP3` audio options at the top of the list with video titles, format badges, and resolutions on YouTube, X (Twitter), and Instagram.
* **Comprehensive Page Scanner**: Scans DOM elements, background resources, and media elements across modern single-page web applications (including YouTube/X/Instagram SPA navigation).
* **Network & XHR Interceptor**: Live deep traffic interception catching stream chunks, audio segments, images, and videos in real time.
* **Batch Downloader**: Select multiple resources or select all and batch download with filename sanitization.
* **Security Hardened**: Protected against command injection, argument injection, SSRF, directory traversal, CRLF header injection, and untrusted message spoofing.

---

## 📥 Installation Guide

### Load Unpacked Extension (Chrome / Brave / Edge)
1. Clone this repository or click **Code → Download ZIP** on GitHub and extract it:
   ```bash
   git clone https://github.com/rishabh98080/MediaHunter.git
   ```
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top right.
4. Click **Load unpacked** and select the extracted `MediaHunter` folder (the one containing `manifest.json`).
5. Pin **MediaHunter** to your browser toolbar!
6. *(Recommended for YouTube / X / Instagram multi-quality `yt-dlp` support)* Run the one-time setup in [`local-setup/`](local-setup/) below.

---

## ⚡ Local Companion Setup (Multi-Quality `yt-dlp`)

### Why a Local Companion?
Chrome extensions run inside a browser sandbox and cannot execute local binaries like `yt-dlp` or `ffmpeg` directly. To unlock multi-tier quality extraction (`1080p` muxed MP4, `720p`, `480p`, `360p`, `MP3` audio) on platforms like YouTube, X (Twitter), and Instagram, MediaHunter connects locally to `http://127.0.0.1:9527`.

> Without the local companion running, MediaHunter still works normally for DOM and network media detection — it just won't show the `yt-dlp` multi-quality entries at the top.

The [`local-setup/`](local-setup/) folder provides a **one-time setup** that installs the companion and registers it as a **startup application** so it runs automatically in the background whenever you log in (no manual terminal commands needed afterwards).

### Folder Structure
* [`local-setup/companion.py`](local-setup/companion.py) — Cross-platform HTTP companion service (`127.0.0.1:9527`).
* [`local-setup/linux/`](local-setup/linux/) — Standalone Linux binary (`mediahunter-companion`), `setup.sh`, `uninstall.sh`, and `build.sh`.
* [`local-setup/windows/`](local-setup/windows/) — Windows `setup.bat`, `uninstall.bat`, and `build-exe.bat` (to compile a standalone `mediahunter-companion.exe`).

### Linux (Ubuntu / Desktop)
1. Ensure `ffmpeg` (and `yt-dlp` if not using `pip`) are installed for best muxing & audio conversion:
   ```bash
   sudo apt update && sudo apt install -y yt-dlp ffmpeg
   ```
2. Run the one-time setup from [`local-setup/linux/`](local-setup/linux/):
   ```bash
   cd local-setup/linux
   chmod +x setup.sh uninstall.sh build.sh
   ./setup.sh
   ```
   **What `setup.sh` does:**
   * Installs the standalone `mediahunter-companion` binary to `~/.local/bin/`.
   * Registers it as a login startup service (`systemd --user` `mediahunter-companion.service`, with an XDG `~/.config/autostart/mediahunter-companion.desktop` fallback).
   * Starts the service immediately.
3. To remove startup registration later, run `./uninstall.sh`.

### Windows
1. *(Optional, for a standalone `.exe`)* If you want a single executable without needing Python at runtime, install Python 3 and run [`local-setup/windows/build-exe.bat`](local-setup/windows/build-exe.bat) to generate `mediahunter-companion.exe`.
2. Run [`local-setup/windows/setup.bat`](local-setup/windows/setup.bat) once:
   * Checks/installs `yt-dlp` via `winget` or `pip` if missing (`ffmpeg` on `PATH` is recommended for 1080p+ muxing & MP3).
   * Installs `mediahunter-companion.exe` (or falls back silently to `companion.py` via `pythonw.exe` + VBScript with no console window).
   * Registers automatic login startup in `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` (`MediaHunterCompanion`).
   * Starts the companion immediately in the background.
3. To remove startup registration later, run [`local-setup/windows/uninstall.bat`](local-setup/windows/uninstall.bat).

### Verify Companion Status
Once set up, open `http://127.0.0.1:9527/status` in Chrome (or check with `curl`):
```json
{
  "status": "ok",
  "companion": "MediaHunter yt-dlp Companion (Multi-Quality)",
  "ytdlp_available": true,
  "port": 9527
}
```

---

## ☕ Support

If you find MediaHunter useful, consider supporting its development:

[![Buy Me a Coffee](https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RishabhKumar484874)

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
