# MediaHunter 🎬🔍

<p align="center">
  <img src="MediaHunter/icons/icon128.png" alt="MediaHunter Logo" width="100" />
</p>

<p align="center">
  <strong>Next-Generation Media Discovery & Download Suite for Chrome</strong>
</p>

<p align="center">
  <a href="#-quick-download">Download Extension</a> •
  <a href="#-features">Features</a> •
  <a href="#-installation-guide">Installation</a> •
  <a href="#-companion-server-setup">Companion Server</a> •
  <a href="#-development">Development</a>
</p>

---

## 🚀 Quick Download

Direct downloadable assets are included right in the repository:

* 📦 **[Download MediaHunter.zip](MediaHunter.zip)** — Unpack and load directly into Chrome / Brave / Edge.
* 🧩 **[Download MediaHunter.crx](MediaHunter.crx)** — Packaged extension binary ready for drag-and-drop install.

---

## ✨ Features

* **Apple-Inspired Dark Obsidian UI**: Polished glassmorphism design with soft neon violet accents (`#6946fb`), responsive preview drawer, and clean typography.
* **Smart Multi-Quality Video Extraction**: Powered by `yt-dlp` companion server with multi-quality resolution selection (1080p, 720p, 480p, 360p, HQ Audio).
* **Comprehensive Page Scanner**: Scans DOM elements, background resources, and media elements across modern dynamic single-page web applications.
* **Network & XHR Interceptor**: Live deep traffic interception catching stream chunks, audio segments, images, and videos in real time.
* **Batch Downloader**: Select multiple resources or select all and batch download with custom sanitization.
* **Security Hardened**: Protected against command injection, argument injection, SSRF, directory traversal, CRLF header injection, and untrusted message spoofing.

---

## 📥 Installation Guide

### Option 1: Load Unpacked from ZIP (Recommended)
1. Download **[`MediaHunter.zip`](MediaHunter.zip)** and extract it to a folder.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top right.
4. Click **Load unpacked** and select the extracted `MediaHunter` folder.
5. Pin **MediaHunter** to your browser toolbar!

### Option 2: Install via .CRX
1. Download **[`MediaHunter.crx`](MediaHunter.crx)**.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode**.
4. Drag and drop the `MediaHunter.crx` file onto the extensions page to install.

---

## ⚡ Companion Server Setup (for Multi-Quality Video Extraction)

MediaHunter includes a lightweight local Python companion that leverages `yt-dlp` to extract high-resolution video streams and mux high-quality audio seamlessly.

### Quick Start:
```bash
# 1. Ensure Python 3 and yt-dlp / ffmpeg are installed
pip install yt-dlp
sudo apt install ffmpeg  # Or brew install ffmpeg on macOS

# 2. Run the companion script
python3 companion.py
# Or use the convenience launcher:
./start-companion.sh
```

The companion server starts on `127.0.0.1:9527`. MediaHunter automatically connects to it whenever you open media pages.

---

## 🛠️ Development & Building from Source

```bash
# 1. Clone repository
git clone https://github.com/rishabh98080/MediaHunter.git
cd MediaHunter

# 2. Install dependencies
npm install

# 3. Build production bundle (auto-syncs to MediaHunter/)
npm run build

# 4. Run lint check
npm run lint
```

---

## ☕ Support

If you find MediaHunter useful, consider supporting its development:

[![Buy Me a Coffee](https://img.shields.io/badge/Donate-PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/RishabhKumar484874)

---

## 📄 License

MIT License. See [LICENSE](LICENSE) for details.
