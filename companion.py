#!/usr/bin/env python3
"""
MediaHunter - Local yt-dlp Companion Service (Multi-Quality Edition - Hardened)

Provides multi-tier quality options (1080p, 720p, 480p, 360p, Audio)
for YouTube, X.com/Twitter, Instagram, and other supported platforms.

Runs on: http://127.0.0.1:9527
Requires: yt-dlp
"""

import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse

PORT = 9527
HOST = "127.0.0.1"
CACHE_DIR = "/tmp/mediahunter_cache"

YTDLP_BIN = shutil.which("yt-dlp") or "/usr/bin/yt-dlp" or "/usr/local/bin/yt-dlp"

# Allowed web origins for CORS (extensions and local dev)
ALLOWED_ORIGIN_PATTERNS = [
    re.compile(r"^chrome-extension://[a-z]{32}$"),
    re.compile(r"^moz-extension://[a-f0-9\-]+$"),
    re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"),
]


def is_allowed_origin(origin):
    if not origin:
        return True
    return any(p.match(origin) for p in ALLOWED_ORIGIN_PATTERNS)


def validate_target_url(url):
    """Validate that the URL has an http or https scheme and is not local SSRF target."""
    if not url or not isinstance(url, str):
        return False, "Target URL must be a non-empty string."
    try:
        parsed = urllib.parse.urlparse(url.strip())
        if parsed.scheme.lower() not in ("http", "https"):
            return False, "Only HTTP and HTTPS URLs are permitted."
        if not parsed.netloc:
            return False, "Invalid URL host."
        # Disallow loopback / local IP addresses to prevent SSRF
        hostname = (parsed.hostname or "").lower()
        if hostname in ("127.0.0.1", "localhost", "0.0.0.0", "::1", "169.254.169.254") or hostname.endswith(".internal"):
            return False, "Local or private network addresses are disallowed."
        return True, ""
    except Exception as e:
        return False, f"Malformed URL: {e}"


def get_ytdlp_version():
    try:
        res = subprocess.run([YTDLP_BIN, "--version"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0:
            return res.stdout.strip()
    except Exception:
        pass
    return "unknown"


def extract_info(target_url):
    """Run yt-dlp -J to extract metadata and multi-tier quality options safely."""
    valid, err_msg = validate_target_url(target_url)
    if not valid:
        return {"success": False, "error": err_msg}

    if not os.path.exists(YTDLP_BIN):
        return {"success": False, "error": f"yt-dlp not found at {YTDLP_BIN}"}

    # Prepend '--' before target_url to prevent command-line option injection
    cmd = [
        YTDLP_BIN,
        "-J",
        "--no-playlist",
        "--no-warnings",
        "--",
        target_url
    ]

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
        if proc.returncode != 0 or not proc.stdout.strip():
            cmd_fallback = [YTDLP_BIN, "-J", "--no-playlist", "--no-warnings", "--", target_url]
            proc = subprocess.run(cmd_fallback, capture_output=True, text=True, timeout=25)

        if proc.returncode != 0 or not proc.stdout.strip():
            err = proc.stderr.strip() or "No media could be extracted by yt-dlp"
            return {"success": False, "error": err}

        data = json.loads(proc.stdout.strip())
        video_id = data.get("id") or str(abs(hash(target_url)))
        title = data.get("title") or "video"
        thumbnail = data.get("thumbnail") or None
        duration = data.get("duration") or None
        formats = data.get("formats", [])

        # Build quality options
        qualities = []
        desired_heights = [2160, 1440, 1080, 720, 480, 360]
        chosen_by_height = {}

        for f in formats:
            h = f.get("height")
            vcodec = f.get("vcodec") or "none"
            u = f.get("url")
            if not u or vcodec == "none" or not h:
                continue

            matched_h = None
            for dh in desired_heights:
                if abs(h - dh) <= 30:
                    matched_h = dh
                    break
            if not matched_h:
                matched_h = h

            ext = (f.get("ext") or "mp4").lower()
            cur = chosen_by_height.get(matched_h)
            if not cur or (cur.get("ext") != "mp4" and ext == "mp4") or (f.get("filesize") or 0) > (cur.get("filesize") or 0):
                chosen_by_height[matched_h] = f

        # Sort video qualities descending (e.g. 1080p, 720p, 480p, 360p)
        for h in sorted(chosen_by_height.keys(), reverse=True):
            f = chosen_by_height[h]
            q_label = f"{h}p"
            ext = (f.get("ext") or "mp4").lower()
            size = f.get("filesize") or f.get("filesize_approx")
            width = f.get("width")
            res_str = f.get("resolution") or (f"{width}x{h}" if width else f"{h}p")
            qualities.append({
                "quality": q_label,
                "label": f"{q_label} {'Full HD' if h >= 1080 else 'HD' if h >= 720 else 'SD'}",
                "ext": ext,
                "format": f"{h}P",
                "type": "Video",
                "mime": f"video/{ext}",
                "resolution": res_str,
                "filesize": size,
                "direct_url": f.get("url"),
                "stream_url": f"http://{HOST}:{PORT}/stream?url={urllib.parse.quote(target_url, safe='')}&quality={q_label}&title={urllib.parse.quote(title, safe='')}",
            })

        # Check for best audio stream
        best_audio = None
        for f in formats:
            vcodec = f.get("vcodec") or "none"
            acodec = f.get("acodec") or "none"
            u = f.get("url")
            if vcodec == "none" and acodec != "none" and u:
                if not best_audio or (f.get("abr") or 0) > (best_audio.get("abr") or 0):
                    best_audio = f

        if best_audio:
            ext = (best_audio.get("ext") or "m4a").lower()
            abr = best_audio.get("abr")
            abr_str = f"{int(abr)}kbps" if abr else "HQ"
            qualities.append({
                "quality": "audio",
                "label": f"Audio Only ({abr_str})",
                "ext": "mp3" if ext in ["mp3", "m4a"] else ext,
                "format": "MP3" if ext in ["mp3", "m4a"] else ext.upper(),
                "type": "Audio",
                "mime": "audio/mpeg" if ext == "mp3" else f"audio/{ext}",
                "resolution": f"Audio {abr_str}",
                "filesize": best_audio.get("filesize") or best_audio.get("filesize_approx"),
                "direct_url": best_audio.get("url"),
                "stream_url": f"http://{HOST}:{PORT}/stream?url={urllib.parse.quote(target_url, safe='')}&quality=audio&title={urllib.parse.quote(title, safe='')}",
            })

        # Fallback if no specific formats matched
        if not qualities:
            ext = (data.get("ext") or "mp4").lower()
            qualities.append({
                "quality": "best",
                "label": "Best Quality",
                "ext": ext,
                "format": ext.upper(),
                "type": "Video",
                "mime": f"video/{ext}",
                "resolution": data.get("resolution") or "Standard",
                "filesize": data.get("filesize") or data.get("filesize_approx"),
                "direct_url": data.get("url"),
                "stream_url": f"http://{HOST}:{PORT}/stream?url={urllib.parse.quote(target_url, safe='')}&quality=best&title={urllib.parse.quote(title, safe='')}",
            })

        return {
            "success": True,
            "id": video_id,
            "title": title,
            "thumbnail": thumbnail,
            "duration": duration,
            "qualities": qualities,
            "source": "yt-dlp",
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "yt-dlp extraction timed out."}
    except Exception as e:
        return {"success": False, "error": str(e)}


class CompanionHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        sys.stderr.write(f"[MediaHunter Companion] {args[0]}\n")

    def send_cors_headers(self):
        origin = self.headers.get("Origin", "")
        if is_allowed_origin(origin):
            self.send_header("Access-Control-Allow-Origin", origin or "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        else:
            self.send_header("Access-Control-Allow-Origin", "null")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self):
        origin = self.headers.get("Origin", "")
        if origin and not is_allowed_origin(origin):
            self.send_response(403)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(b'{"error": "Forbidden origin"}')
            return

        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        # 1. Status / Health
        if path in ["/status", "/health", "/"]:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            resp = {
                "status": "ok",
                "companion": "MediaHunter yt-dlp Companion (Multi-Quality)",
                "ytdlp_available": os.path.exists(YTDLP_BIN),
                "ytdlp_version": get_ytdlp_version(),
                "port": PORT,
            }
            try:
                self.wfile.write(json.dumps(resp).encode("utf-8"))
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        # 2. Extract multi-quality media items
        if path == "/extract":
            target_url = qs.get("url", [""])[0]
            if not target_url:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": "Missing 'url' query parameter"}).encode("utf-8"))
                return

            result = extract_info(target_url)
            status_code = 200 if result.get("success") else 400
            self.send_response(status_code)
            self.send_header("Content-Type", "application/json")
            self.send_cors_headers()
            self.end_headers()
            try:
                self.wfile.write(json.dumps(result).encode("utf-8"))
            except (BrokenPipeError, ConnectionResetError):
                pass
            return

        # 3. Stream / Download specific quality with muxed audio
        if path == "/stream":
            target_url = qs.get("url", [""])[0]
            valid, err_msg = validate_target_url(target_url)
            if not valid:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": err_msg}).encode("utf-8"))
                return

            quality = qs.get("quality", ["best"])[0].lower()
            # Only allow alphanumeric or safe quality descriptors
            if not re.match(r"^(best|audio|\d{3,4}p)$", quality):
                quality = "best"

            title = qs.get("title", ["video"])[0]
            # Sanitize title strictly to prevent header injection or path traversal
            safe_title = "".join(c for c in title if c.isalnum() or c in " ._-").strip() or "video"
            safe_title = safe_title.replace("\r", "").replace("\n", "").replace('"', '').replace("/", "").replace("\\", "")

            os.makedirs(CACHE_DIR, exist_ok=True)
            video_hash = str(abs(hash(f"{target_url}_{quality}")))

            if quality == "audio":
                format_spec = "bestaudio/140/best"
                ext = "mp3"
                content_type = "audio/mpeg"
                dl_filename = f"{safe_title} [Audio].{ext}"
            elif quality.endswith("p") and quality[:-1].isdigit():
                h = quality[:-1]
                format_spec = f"bestvideo[height<={h}]+bestaudio/best[height<={h}]/best"
                ext = "mp4"
                content_type = "video/mp4"
                dl_filename = f"{safe_title} [{quality}].{ext}"
            else:
                format_spec = "bestvideo+bestaudio/best"
                ext = "mp4"
                content_type = "video/mp4"
                dl_filename = f"{safe_title}.{ext}"

            cached_file = os.path.join(CACHE_DIR, f"{video_hash}.{ext}")

            # If not in cache, download via yt-dlp with android client args
            if not os.path.exists(cached_file) or os.path.getsize(cached_file) == 0:
                cmd = [
                    YTDLP_BIN,
                    "--extractor-args", "youtube:player_client=android,ios,web",
                    "-f", format_spec,
                    "--no-playlist",
                    "--no-warnings",
                    "-o", cached_file,
                    "--",
                    target_url
                ]
                subprocess.run(cmd, capture_output=True, timeout=90)

            if os.path.exists(cached_file) and os.path.getsize(cached_file) > 0:
                file_size = os.path.getsize(cached_file)
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(file_size))
                self.send_header("Content-Disposition", f'attachment; filename="{dl_filename}"')
                self.send_cors_headers()
                self.end_headers()

                try:
                    with open(cached_file, "rb") as f:
                        while True:
                            chunk = f.read(64 * 1024)
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass
                return

            # Fallback: direct progressive stream if caching was not possible
            cmd_pipe = [
                YTDLP_BIN,
                "-o", "-",
                "--no-playlist",
                "--no-warnings",
                "-f", "18/best[ext=mp4]/best",
                "--",
                target_url
            ]
            proc = None
            try:
                proc = subprocess.Popen(cmd_pipe, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Disposition", f'attachment; filename="{safe_title}.mp4"')
                self.send_cors_headers()
                self.end_headers()
                while True:
                    chunk = proc.stdout.read(64 * 1024)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:
                sys.stderr.write(f"Pipe error: {e}\n")
            finally:
                if proc:
                    if proc.stdout:
                        proc.stdout.close()
                    if proc.poll() is None:
                        proc.kill()
                    proc.wait()
            return

        self.send_response(404)
        self.send_cors_headers()
        self.end_headers()


def run_server():
    server = http.server.ThreadingHTTPServer((HOST, PORT), CompanionHandler)
    print(f"MediaHunter Companion (Multi-Quality) running at http://{HOST}:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping MediaHunter Companion.")
        server.server_close()


if __name__ == "__main__":
    run_server()
