/**
 * MediaHunter - MAIN World XHR/Fetch Interceptor
 *
 * This script is injected into the page's MAIN execution world (not the isolated
 * content-script world). It hooks window.fetch and XMLHttpRequest to intercept
 * real video/audio CDN URLs *before* they are fed into MediaSource (becoming
 * opaque blob: streams). This is the only way to capture URLs on platforms like
 * X/Twitter and Instagram that use short-lived CDN links not visible in the DOM.
 *
 * HOW MSE PLATFORMS WORK (and why blob: can't be downloaded):
 *
 *   Page JS:
 *     ① fetch("https://cdn.example.com/video.m3u8") → manifest
 *     ② fetch("https://cdn.example.com/seg001.ts")  → segment bytes
 *     ③ mediaSource.appendBuffer(segment_bytes)
 *     ④ <video src="blob:..."> ← this is what you see in DevTools
 *
 *   The blob: URL is just a live pipe from MSE into the decoder.
 *   We can't read it. We CAN intercept step ① and ② instead.
 *
 * PLATFORM REALITIES:
 *   YouTube  - Uses DASH with token-signed URLs + Widevine DRM for some content.
 *              The videoplayback?... URL IS the actual media and can be downloaded
 *              when visible (non-DRM content). The webRequest observer already
 *              captures it. DRM-encrypted content cannot be decrypted.
 *   X/Twitter - Uses HLS (m3u8) served from video.twimg.com. No DRM. URLs are
 *              interceptable here and downloadable directly.
 *   Instagram - Uses direct CDN MP4 URLs from cdninstagram.com. No DRM. Already
 *              captured by webRequest, but this hook catches them earlier.
 *   TikTok   - Uses direct CDN URLs, often in page JSON responses. Interceptable.
 *   Reddit   - Direct video URLs, often from v.redd.it. Already visible to webRequest.
 */

(function () {
  'use strict';

  if (window.__mediaHunterXhrHooked) return;
  window.__mediaHunterXhrHooked = true;

  /* -------------------------------------------------------
     Platform-specific URL matchers
     (URL patterns that reliably indicate downloadable media)
  ------------------------------------------------------- */

  /**
   * Returns { type, format, quality } if url looks like a real CDN media URL,
   * or null to ignore it.
   */
  function classifyMediaUrl(url) {
    try {
      const u = new URL(url);
      const host = u.hostname.toLowerCase();
      const path = u.pathname.toLowerCase();
      const href = url.toLowerCase();

      // ---- X / Twitter ----
      // video.twimg.com serves HLS playlists and direct MP4 segments
      if (host === 'video.twimg.com') {
        if (path.endsWith('.m3u8')) {
          return { type: 'Stream', format: 'M3U8', platform: 'X (Twitter)' };
        }
        if (path.endsWith('.mp4') || path.includes('/ext_tw_video/') || path.includes('/tweet_video/')) {
          return { type: 'Video', format: 'MP4', platform: 'X (Twitter)' };
        }
      }

      // ---- Instagram ----
      // cdninstagram.com and scontent-*.fbcdn.net serve MP4 and images
      if (
        host.includes('cdninstagram.com') ||
        host.includes('fbcdn.net') ||
        host.includes('instagram.com')
      ) {
        if (path.endsWith('.mp4') || href.includes('video_dashinit') || href.includes('efg=') && href.includes('bytestart')) {
          return { type: 'Video', format: 'MP4', platform: 'Instagram' };
        }
        if (path.endsWith('.jpg') || path.endsWith('.webp') || path.endsWith('.png')) {
          return { type: 'Image', format: path.split('.').pop().toUpperCase(), platform: 'Instagram' };
        }
        if (path.endsWith('.m3u8') || path.endsWith('.mpd')) {
          return { type: 'Stream', format: path.endsWith('.mpd') ? 'MPD' : 'M3U8', platform: 'Instagram' };
        }
      }

      // ---- YouTube ----
      // googlevideo.com / youtube.com videoplayback = the actual video+audio
      if (
        (host.endsWith('googlevideo.com') || host.includes('youtube.com')) &&
        (path.includes('videoplayback') || u.searchParams.has('mime'))
      ) {
        const mime = u.searchParams.get('mime') || '';
        if (mime.startsWith('video/')) return { type: 'Video', format: mime.split('/')[1]?.toUpperCase() || 'MP4', platform: 'YouTube' };
        if (mime.startsWith('audio/')) return { type: 'Audio', format: mime.split('/')[1]?.toUpperCase() || 'M4A', platform: 'YouTube' };
        return { type: 'Video', format: 'MP4', platform: 'YouTube' };
      }

      // ---- TikTok ----
      if (
        host.includes('tiktokcdn.com') ||
        host.includes('tiktokv.com') ||
        host.includes('muscdn.com') ||
        host.includes('byteoversea.com') ||
        host.includes('tiktok.com')
      ) {
        if (path.endsWith('.mp4') || href.includes('mime_type=video') || href.includes('video_mp4')) {
          return { type: 'Video', format: 'MP4', platform: 'TikTok' };
        }
      }

      // ---- Reddit ----
      if (host === 'v.redd.it' || host.includes('reddit.com')) {
        if (path.endsWith('.mp4') || path.includes('/DASH_') || path.includes('HLSPlaylist')) {
          const format = path.includes('HLSPlaylist') ? 'M3U8' : 'MP4';
          return { type: format === 'M3U8' ? 'Stream' : 'Video', format, platform: 'Reddit' };
        }
      }

      // ---- Generic: any URL that returns video/audio MIME ----
      // (checked in sendToBackground based on response headers when available)

      // Generic: catch-all for URLs with explicit video/audio extensions
      if (/\.(mp4|webm|mov|m4v|mkv|avi)(\?|#|$)/i.test(url)) {
        return { type: 'Video', format: url.match(/\.(mp4|webm|mov|m4v|mkv|avi)/i)?.[1]?.toUpperCase() || 'MP4', platform: 'Generic' };
      }
      if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(url)) {
        return { type: 'Audio', format: url.match(/\.(mp3|wav|ogg|m4a|aac|flac)/i)?.[1]?.toUpperCase() || 'MP3', platform: 'Generic' };
      }
      if (/\.(m3u8|mpd)(\?|#|$)/i.test(url)) {
        return { type: 'Stream', format: url.includes('.mpd') ? 'MPD' : 'M3U8', platform: 'Generic' };
      }

    } catch {
      // ignore malformed URLs
    }

    return null;
  }

  /**
   * Deduplicated sending to MediaHunter content script bridge
   */
  const sentUrls = new Set();

  function sendToBackground(url, classification, extraMeta = {}) {
    if (!url || sentUrls.has(url)) return;
    sentUrls.add(url);

    const item = {
      id: `xhr_${url}`,
      url,
      name: extraMeta.filename || inferFilename(url, classification),
      mime: extraMeta.mime || '',
      type: classification.type,
      format: classification.format,
      size: extraMeta.size || null,
      status: extraMeta.status || null,
      requestType: 'xhr_intercept',
      timestamp: Date.now(),
      source: `${classification.platform} (XHR intercept)`,
      dimensions: null,
      thumbnail: null,
    };

    // Post to content script via a custom DOM event (safe cross-world bridge)
    document.dispatchEvent(new CustomEvent('__mediahunter_url_found__', {
      detail: JSON.stringify(item),
    }));
  }

  function inferFilename(url, classification) {
    try {
      const u = new URL(url);
      const segments = u.pathname.split('/').filter(Boolean);
      const last = segments.pop();
      if (last && last.length < 80 && last.includes('.')) {
        return decodeURIComponent(last);
      }
      // Build a friendly name from platform + type
      const ext = classification.format.toLowerCase();
      const platform = (classification.platform || 'media').toLowerCase().replace(/[^a-z0-9]/g, '_');
      const id = last ? last.substring(0, 10) : Date.now().toString(36);
      return `${platform}_${id}.${ext}`;
    } catch {
      return `media.${(classification.format || 'mp4').toLowerCase()}`;
    }
  }

  /* -------------------------------------------------------
     Hook window.fetch
  ------------------------------------------------------- */

  const originalFetch = window.fetch;
  window.fetch = function (input, ...fetchArgs) {
    const url = typeof input === 'string' ? input : input?.url || '';

    if (url && !url.startsWith('blob:') && !url.startsWith('data:')) {
      const classification = classifyMediaUrl(url);
      if (classification) {
        // We have a hit even before the response — report URL immediately so the
        // user can see it appearing in real-time as the page loads media
        sendToBackground(url, classification);
      }
    }

    return originalFetch.apply(this, [input, ...fetchArgs]);
  };

  /* -------------------------------------------------------
     Hook XMLHttpRequest
  ------------------------------------------------------- */

  const OriginalXHR = window.XMLHttpRequest;

  window.XMLHttpRequest = function () {
    const xhr = new OriginalXHR();
    const originalOpen = xhr.open.bind(xhr);

    xhr.open = function (method, url, ...rest) {
      if (typeof url === 'string' && !url.startsWith('blob:') && !url.startsWith('data:')) {
        const classification = classifyMediaUrl(url);
        if (classification) {
          sendToBackground(url, classification);
        }
      }
      return originalOpen(method, url, ...rest);
    };

    return xhr;
  };

  // Copy static methods from original XHR
  Object.assign(window.XMLHttpRequest, OriginalXHR);

})();
