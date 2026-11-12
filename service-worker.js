/**
 * MediaHunter - Background Service Worker (Manifest V3)
 * 
 * Responsibilities:
 * - Network observation via chrome.webRequest (headers, mime, size from content-length & content-range)
 * - DOM scanning coordination (content-script messaging and chrome.scripting fallback)
 * - Result normalization, merging, deduplication, and per-tab storage (in-memory + chrome.storage.session)
 * - Browser-managed downloads via chrome.downloads API, including blob: URL downloading via
 *   the chrome.offscreen API (the official MV3 mechanism for DOM access in the background)
 * - Tab lifecycle management and cleanup
 */

'use strict';

// In-memory tab store: tabId -> Map<urlKey, MediaItem>
const tabMediaStore = new Map();
// Last known URL (without hash) per tab for SPA navigation detection
const tabUrlStore = new Map();
// In-flight yt-dlp extraction promises keyed by `${tabId}:${cleanUrl}`
const inFlightExtractions = new Map();
// Timers for debounced popup updates: tabId -> timer
const notifyTimers = new Map();

/* --------------------------------------------------
   yt-dlp Local Companion Configuration & Helpers
   (Dedicated support for YouTube, X.com/Twitter, Instagram)
-------------------------------------------------- */

const COMPANION_URL = 'http://127.0.0.1:9527';

function stripUrlHash(url = '') {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url.split('#')[0];
  }
}

function isYtDlpPlatform(url = '') {
  if (!url) return false;
  return /^(https?:\/\/)?([a-z0-9-]+\.)*(youtube\.com|youtu\.be|x\.com|twitter\.com|instagram\.com)(\/|$)/i.test(url);
}

async function extractViaCompanion(pageUrl) {
  if (!pageUrl || !isYtDlpPlatform(pageUrl)) return null;
  try {
    const encoded = encodeURIComponent(pageUrl);
    const res = await fetch(`${COMPANION_URL}/extract?url=${encoded}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.success) return null;
    return data;
  } catch {
    return null;
  }
}

function extractViaCompanionForTab(tabId, pageUrl) {
  if (!tabId || !pageUrl || !isYtDlpPlatform(pageUrl)) {
    return Promise.resolve(null);
  }
  const cleanUrl = stripUrlHash(pageUrl);
  const flightKey = `${tabId}:${cleanUrl}`;
  if (inFlightExtractions.has(flightKey)) {
    return inFlightExtractions.get(flightKey);
  }

  const promise = extractViaCompanion(pageUrl)
    .then((ytdlpData) => {
      if (!ytdlpData) return null;
      const latestUrl = tabUrlStore.get(tabId);
      if (latestUrl && latestUrl !== cleanUrl) {
        return null;
      }
      registerYtDlpItems(tabId, ytdlpData, pageUrl);
      return ytdlpData;
    })
    .catch(() => null)
    .finally(() => {
      inFlightExtractions.delete(flightKey);
    });

  inFlightExtractions.set(flightKey, promise);
  return promise;
}

function sortMediaWithYtDlpFirst(items) {
  if (!Array.isArray(items)) return [];
  return [...items].sort((a, b) => {
    const aPriority = a.source === 'yt-dlp' || a.isPriority ? 1 : 0;
    const bPriority = b.source === 'yt-dlp' || b.isPriority ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return (a.timestamp ?? 0) - (b.timestamp ?? 0);
  });
}

function registerYtDlpItems(tabId, ytdlpData, pageUrl) {
  if (!tabId || !ytdlpData) return;

  const qualities = Array.isArray(ytdlpData.qualities) && ytdlpData.qualities.length > 0
    ? ytdlpData.qualities
    : [{
        quality: 'best',
        label: 'Best Quality',
        ext: ytdlpData.ext || 'mp4',
        format: (ytdlpData.ext || 'MP4').toUpperCase(),
        type: 'Video',
        mime: ytdlpData.mime || 'video/mp4',
        resolution: ytdlpData.resolution || null,
        filesize: ytdlpData.filesize || null,
        stream_url: ytdlpData.stream_url,
        direct_url: ytdlpData.direct_url,
      }];

  let qIndex = 0;
  for (const q of qualities) {
    const isAudio = q.type === 'Audio' || q.quality === 'audio';
    const ext = q.ext || (isAudio ? 'mp3' : 'mp4');
    const formatLabel = q.format || (isAudio ? 'MP3' : (q.quality || 'MP4').toUpperCase());
    const qualitySuffix = q.quality ? ` [${q.quality}]` : '';

    const item = {
      id: `ytdlp_${ytdlpData.id || encodeURIComponent(pageUrl)}_${q.quality || qIndex}`,
      url: q.stream_url || q.direct_url,
      directUrl: q.direct_url,
      name: sanitizeFilename(`${ytdlpData.title || 'video'}${qualitySuffix}.${ext}`),
      mime: q.mime || (isAudio ? 'audio/mpeg' : 'video/mp4'),
      type: isAudio ? 'Audio' : 'Video',
      format: formatLabel,
      size: q.filesize || null,
      status: 200,
      requestType: 'yt-dlp',
      timestamp: qIndex,
      source: 'yt-dlp',
      dimensions: q.resolution || null,
      thumbnail: ytdlpData.thumbnail || null,
      isPriority: true,
    };
    addOrUpdateItemSync(tabId, item);
    qIndex++;
  }
}

/* --------------------------------------------------
   Classification & Formatting Helpers
-------------------------------------------------- */

function getMediaType(mimeType = '', url = '') {
  const mime = mimeType.toLowerCase();
  const pathname = url.split('?')[0].split('#')[0].toLowerCase();

  if (
    mime.includes('image/') ||
    /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|ico)$/.test(pathname)
  ) {
    return 'Image';
  }

  if (
    mime.includes('video/') ||
    /\.(mp4|webm|mov|m4v|mkv|avi)$/.test(pathname)
  ) {
    return 'Video';
  }

  if (
    mime.includes('audio/') ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(pathname)
  ) {
    return 'Audio';
  }

  if (
    mime.includes('pdf') ||
    /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/.test(pathname)
  ) {
    return 'Document';
  }

  if (
    mime.includes('mpegurl') ||
    mime.includes('dash+xml') ||
    /\.(m3u8|mpd)$/.test(pathname)
  ) {
    return 'Stream';
  }

  return 'Other';
}

function getFormat(url = '', mimeType = '') {
  try {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const parts = cleanUrl.split('.');
    if (parts.length > 1) {
      const ext = parts.pop().toLowerCase();
      if (ext && ext.length <= 6 && /^[a-z0-9]+$/.test(ext)) {
        return ext.toUpperCase();
      }
    }
  } catch {
    // ignore
  }

  if (mimeType) {
    const subtype = mimeType.split('/')[1];
    if (subtype) {
      return subtype.split(';')[0].split('+')[0].toUpperCase();
    }
  }

  return 'UNKNOWN';
}

function getFileNameFromUrl(url = '', fallbackType = '') {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'blob:') {
      const segments = parsed.pathname.split('/').filter(Boolean);
      const uuid = segments.pop() || 'resource';
      const shortId = uuid.substring(0, 8);
      const prefix = fallbackType ? fallbackType.toLowerCase() : 'blob';
      return `${prefix}_${shortId}`;
    }
    const pathname = parsed.pathname;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments.pop();
    if (last) {
      return decodeURIComponent(last);
    }
  } catch {
    // ignore
  }
  return 'media_resource';
}

function parseContentDisposition(headerValue) {
  if (!headerValue) return null;

  // RFC 5987 / 6266 filename*=UTF-8''filename.ext
  const utfMatch = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch && utfMatch[1]) {
    try {
      return decodeURIComponent(utfMatch[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      // ignore
    }
  }

  // filename="filename.ext" or filename=filename.ext
  const match = headerValue.match(/filename=["']?([^;"']+)["']?/i);
  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

function normalizeKey(url) {
  try {
    const u = new URL(url);
    const params = new URLSearchParams(u.search);
    for (const key of Array.from(params.keys())) {
      if (/^utm_|^fbclid|^gclid|^ig_cache_key/i.test(key)) {
        params.delete(key);
      }
    }
    u.search = params.toString();
    return u.href;
  } catch {
    return url;
  }
}

function sanitizeFilename(filename, format) {
  let name = (filename || 'media_download').trim();
  // Strip control characters and null bytes
  name = Array.from(name)
    .filter((char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)
    .join('');
  // Replace illegal filename characters
  name = name.replace(/[<>:"/\\|?*]/g, '_');
  // Strip path traversal and leading/trailing dots/underscores
  name = name.replace(/^[._\s]+/, '').replace(/[._\s]+$/, '');
  // Guard against Windows reserved device filenames
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (reserved.test(name) || !name) {
    name = 'media_download';
  }

  if (format && format !== 'UNKNOWN' && !name.toLowerCase().endsWith(`.${format.toLowerCase()}`)) {
    if (!name.includes('.')) {
      name = `${name}.${format.toLowerCase()}`;
    }
  }

  return name;
}

/* --------------------------------------------------
   Storage & State Management
-------------------------------------------------- */

function getOrCreateTabMap(tabId) {
  let map = tabMediaStore.get(tabId);
  if (!map) {
    map = new Map();
    tabMediaStore.set(tabId, map);

    try {
      const storageKey = `tab_${tabId}`;
      chrome.storage.session.get(storageKey).then((result) => {
        if (Array.isArray(result?.[storageKey])) {
          for (const item of result[storageKey]) {
            const key = normalizeKey(item.url);
            if (!map.has(key)) {
              map.set(key, item);
            }
          }
        }
      }).catch(() => {});
    } catch {
      // storage.session might not be available
    }
  }
  return map;
}

async function hydrateTab(tabId) {
  let map = tabMediaStore.get(tabId);
  if (map && map.size > 0) {
    return map;
  }

  if (!map) {
    map = new Map();
    tabMediaStore.set(tabId, map);
  }

  try {
    const storageKey = `tab_${tabId}`;
    const result = await chrome.storage.session.get(storageKey);
    if (Array.isArray(result?.[storageKey])) {
      for (const item of result[storageKey]) {
        map.set(normalizeKey(item.url), item);
      }
    }
  } catch {
    // Session storage not available or error
  }

  return map;
}

async function persistTab(tabId) {
  const map = tabMediaStore.get(tabId);
  if (!map) return;

  try {
    const storageKey = `tab_${tabId}`;
    const items = Array.from(map.values());
    await chrome.storage.session.set({ [storageKey]: items });
  } catch {
    // ignore
  }
}

async function clearTab(tabId) {
  tabMediaStore.delete(tabId);
  if (notifyTimers.has(tabId)) {
    clearTimeout(notifyTimers.get(tabId));
    notifyTimers.delete(tabId);
  }
  try {
    await chrome.storage.session.remove(`tab_${tabId}`);
  } catch {
    // ignore
  }
}

function debouncedNotifyTab(tabId) {
  if (notifyTimers.has(tabId)) return;

  const timer = setTimeout(async () => {
    notifyTimers.delete(tabId);
    await persistTab(tabId);

    try {
      const map = tabMediaStore.get(tabId);
      const mediaList = map ? sortMediaWithYtDlpFirst(Array.from(map.values())) : [];
      chrome.runtime.sendMessage({
        type: 'MEDIA_UPDATED',
        tabId,
        media: mediaList,
      }).catch(() => {
        // Normal when popup is closed
      });
    } catch {
      // ignore
    }
  }, 350);

  notifyTimers.set(tabId, timer);
}

function addOrUpdateItemSync(tabId, item) {
  if (!item || !item.url || item.url.startsWith('blob:')) return;

  const map = getOrCreateTabMap(tabId);
  const key = normalizeKey(item.url);
  const existing = map.get(key);

  if (existing) {
    const merged = {
      ...existing,
      ...item,
      name:
        existing.name &&
        existing.name !== 'media_resource' &&
        !existing.name.startsWith('Unnamed') &&
        !existing.name.startsWith('blob_')
          ? existing.name
          : item.name || existing.name,
      size:
        Number.isFinite(item.size) && item.size > 0
          ? item.size
          : Number.isFinite(existing.size) && existing.size > 0
          ? existing.size
          : null,
      dimensions: existing.dimensions || item.dimensions || null,
      thumbnail: existing.thumbnail || item.thumbnail || null,
      source:
        existing.source === 'yt-dlp' || item.source === 'yt-dlp'
          ? 'yt-dlp'
          : existing.source && item.source && existing.source !== item.source
          ? 'DOM + Network'
          : item.source || existing.source || 'Network',
      status: item.status ?? existing.status ?? null,
      mime: item.mime || existing.mime || '',
      format: item.source === 'yt-dlp' ? (item.format || existing.format) : (existing.format || item.format),
      timestamp: Math.min(existing.timestamp ?? Date.now(), item.timestamp ?? Date.now()),
      isPriority: Boolean(existing.isPriority || item.isPriority),
    };
    map.set(key, merged);
  } else {
    map.set(key, item);
  }

  debouncedNotifyTab(tabId);
}

/* --------------------------------------------------
   Network Observation (chrome.webRequest)
-------------------------------------------------- */

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!details || details.tabId <= 0) return;

    const url = details.url;
    if (
      !url ||
      url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('data:')
    ) {
      return;
    }

    let contentType = '';
    let contentLength = null;
    let contentRange = '';
    let contentDisposition = '';

    if (details.responseHeaders) {
      for (const h of details.responseHeaders) {
        const name = (h.name || '').toLowerCase();
        if (name === 'content-type' && h.value) contentType = h.value.toLowerCase();
        else if (name === 'content-length' && h.value) contentLength = parseInt(h.value, 10);
        else if (name === 'content-range' && h.value) contentRange = h.value;
        else if (name === 'content-disposition' && h.value) contentDisposition = h.value;
      }
    }

    // Extract total size from Content-Range (206 Partial Content video streaming)
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)/);
      if (match && match[1]) {
        const total = parseInt(match[1], 10);
        if (Number.isFinite(total) && total > 0) {
          contentLength = total;
        }
      }
    }

    const mediaType = getMediaType(contentType, url);

    // Platform-specific pass-through: even if content-type wasn't identified,
    // well-known media CDNs should always be captured.
    const isPlatformMediaHost = (
      /googlevideo\.com\/videoplayback/i.test(url) ||            // YouTube segments
      /video\.twimg\.com\//i.test(url) ||                        // X/Twitter video
      /cdninstagram\.com\//i.test(url) ||                        // Instagram CDN
      /\bfbcdn\.net\//i.test(url) ||                             // Facebook/Instagram backup CDN
      /tiktokcdn\.com\//i.test(url) ||                           // TikTok CDN
      /v\.redd\.it\//i.test(url)                                 // Reddit video
    );

    if (mediaType === 'Other') {
      if (!isPlatformMediaHost && details.type !== 'image' && details.type !== 'media') {
        return;
      }
    }

    if (contentLength !== null && contentLength < 32 && mediaType === 'Image') {
      return;
    }

    // Skip individual HLS/DASH segments (they're not standalone downloadable files)
    // UNLESS it comes from a known platform that uses segmented delivery for all content
    if (/\.(ts|m4s|m4v_seg|webm_seg)(\?|$)/i.test(url) && mediaType !== 'Stream') {
      return;
    }

    // For YouTube videoplayback URLs, the MIME type is in the `mime` query param.
    // Extract it here so our format/type detection works correctly.
    let effectiveContentType = contentType;
    if (!effectiveContentType && /googlevideo\.com\/videoplayback/i.test(url)) {
      try {
        const qs = new URL(url).searchParams;
        const mimeParam = qs.get('mime');
        if (mimeParam) effectiveContentType = mimeParam.toLowerCase();
      } catch { /* ignore */ }
    }

    let filename = parseContentDisposition(contentDisposition);
    if (!filename) {
      filename = getFileNameFromUrl(url);
    }

    const format = getFormat(url, effectiveContentType || contentType);
    filename = sanitizeFilename(filename, format);

    const resource = {
      id: `net_${url}`,
      url,
      name: filename,
      mime: (effectiveContentType || contentType).split(';')[0].trim(),
      type: mediaType !== 'Other' ? mediaType : (effectiveContentType.startsWith('video') ? 'Video' : effectiveContentType.startsWith('audio') ? 'Audio' : mediaType),
      format,
      size: Number.isFinite(contentLength) ? contentLength : null,
      status: details.statusCode,
      requestType: details.type || 'Network',
      timestamp: details.timeStamp || Date.now(),
      source: 'Network',
      dimensions: null,
      thumbnail: mediaType === 'Image' ? url : null,
    };

    addOrUpdateItemSync(details.tabId, resource);
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

/* --------------------------------------------------
   Standalone DOM Scanner Function (for executeScript)
-------------------------------------------------- */

function inPageScanner() {
  const mediaMap = new Map();
  const baseURI = document.baseURI || window.location.href;

  function toAbsolute(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (
      !trimmed ||
      trimmed.startsWith('javascript:') ||
      trimmed.startsWith('mailto:') ||
      trimmed.startsWith('chrome-extension:') ||
      trimmed.startsWith('blob:')
    ) {
      return null;
    }
    try {
      return new URL(trimmed, baseURI).href;
    } catch {
      return null;
    }
  }

  function extractFileName(url, fallback) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'blob:') {
        const segments = parsed.pathname.split('/').filter(Boolean);
        const uuid = segments.pop() || 'resource';
        const shortId = uuid.substring(0, 8);
        const prefix = fallback || 'blob';
        return `${prefix}_${shortId}`;
      }
      const pathname = parsed.pathname;
      const segments = pathname.split('/').filter(Boolean);
      const last = segments.pop();
      if (last) return decodeURIComponent(last);
    } catch {
      // ignore
    }
    return fallback || 'media_resource';
  }

  function getFormatFromUrl(url, fallbackType = '') {
    try {
      const clean = url.split('?')[0].split('#')[0];
      const parts = clean.split('.');
      if (parts.length > 1) {
        const ext = parts.pop().toLowerCase();
        if (ext && ext.length <= 6 && /^[a-z0-9]+$/.test(ext)) {
          return ext.toUpperCase();
        }
      }
    } catch {
      // ignore
    }

    if (url.startsWith('blob:')) {
      if (fallbackType === 'Video') return 'MP4';
      if (fallbackType === 'Audio') return 'MP3';
      if (fallbackType === 'Image') return 'PNG';
      if (fallbackType === 'Document') return 'PDF';
    }

    return 'UNKNOWN';
  }

  function addResource(item) {
    if (!item || !item.url) return;
    const url = item.url;
    if (url.startsWith('blob:')) return;
    if (url.startsWith('data:') && url.length < 150) return;

    if (mediaMap.has(url)) {
      const existing = mediaMap.get(url);
      if (!existing.dimensions && item.dimensions) existing.dimensions = item.dimensions;
      if (!existing.thumbnail && item.thumbnail) existing.thumbnail = item.thumbnail;
      if ((!existing.name || existing.name === 'media_resource') && item.name) {
        existing.name = item.name;
      }
    } else {
      mediaMap.set(url, item);
    }
  }

  // 1. Scan Images
  const imgElements = document.querySelectorAll(
    'img, picture source, [data-src], [data-original], [data-lazy-src], [data-high-res-src]'
  );
  for (const el of imgElements) {
    const urls = new Set();
    if (el.currentSrc) urls.add(el.currentSrc);
    if (el.src) urls.add(el.src);
    if (el.getAttribute('data-src')) urls.add(el.getAttribute('data-src'));
    if (el.getAttribute('data-original')) urls.add(el.getAttribute('data-original'));
    if (el.getAttribute('data-lazy-src')) urls.add(el.getAttribute('data-lazy-src'));

    const srcset = el.srcset || el.getAttribute('data-srcset');
    if (srcset) {
      const candidates = srcset.split(',');
      for (const candidate of candidates) {
        const u = candidate.trim().split(/\s+/)[0];
        if (u) urls.add(u);
      }
    }

    const width = el.naturalWidth || el.width || 0;
    const height = el.naturalHeight || el.height || 0;
    if (width === 1 && height === 1) continue;

    const dimensions = width > 0 && height > 0 ? `${width}x${height}` : null;
    const fallbackName = el.alt || el.title || null;

    for (const raw of urls) {
      const absUrl = toAbsolute(raw);
      if (!absUrl) continue;

      addResource({
        id: `dom_${absUrl}`,
        url: absUrl,
        name: fallbackName || extractFileName(absUrl, 'image'),
        mime: absUrl.startsWith('data:image/') ? absUrl.substring(5, absUrl.indexOf(';')) : '',
        type: 'Image',
        format: getFormatFromUrl(absUrl, 'Image'),
        size: null,
        status: 200,
        requestType: 'dom_element',
        timestamp: Date.now(),
        source: 'DOM',
        dimensions,
        thumbnail: absUrl,
      });
    }
  }

  // 2. Scan Videos
  const videoElements = document.querySelectorAll('video');
  for (const v of videoElements) {
    const urls = new Set();
    if (v.currentSrc) urls.add(v.currentSrc);
    if (v.src) urls.add(v.src);
    const sources = v.querySelectorAll('source');
    for (const s of sources) {
      if (s.src) urls.add(s.src);
    }

    const width = v.videoWidth || v.width || 0;
    const height = v.videoHeight || v.height || 0;
    const dimensions = width > 0 && height > 0 ? `${width}x${height}` : null;
    const poster = toAbsolute(v.poster);
    const title = v.title || v.getAttribute('aria-label') || null;

    for (const raw of urls) {
      const absUrl = toAbsolute(raw);
      if (!absUrl) continue;

      const isStream = absUrl.includes('.m3u8') || absUrl.includes('.mpd');
      addResource({
        id: `dom_${absUrl}`,
        url: absUrl,
        name: title || extractFileName(absUrl, isStream ? 'stream_manifest' : 'video'),
        mime: isStream
          ? absUrl.includes('.m3u8')
            ? 'application/vnd.apple.mpegurl'
            : 'application/dash+xml'
          : 'video/mp4',
        type: isStream ? 'Stream' : 'Video',
        format: getFormatFromUrl(absUrl, 'Video'),
        size: null,
        status: 200,
        requestType: 'dom_element',
        timestamp: Date.now(),
        source: 'DOM',
        dimensions,
        thumbnail: poster || null,
      });
    }

    if (poster) {
      addResource({
        id: `dom_${poster}`,
        url: poster,
        name: extractFileName(poster, 'video_poster'),
        mime: '',
        type: 'Image',
        format: getFormatFromUrl(poster, 'Image'),
        size: null,
        status: 200,
        requestType: 'dom_element',
        timestamp: Date.now(),
        source: 'DOM',
        dimensions: null,
        thumbnail: poster,
      });
    }
  }

  // 3. Scan Audio
  const audioElements = document.querySelectorAll('audio');
  for (const a of audioElements) {
    const urls = new Set();
    if (a.currentSrc) urls.add(a.currentSrc);
    if (a.src) urls.add(a.src);
    const sources = a.querySelectorAll('source');
    for (const s of sources) {
      if (s.src) urls.add(s.src);
    }
    const title = a.title || a.getAttribute('aria-label') || null;

    for (const raw of urls) {
      const absUrl = toAbsolute(raw);
      if (!absUrl) continue;

      addResource({
        id: `dom_${absUrl}`,
        url: absUrl,
        name: title || extractFileName(absUrl, 'audio'),
        mime: 'audio/mpeg',
        type: 'Audio',
        format: getFormatFromUrl(absUrl, 'Audio'),
        size: null,
        status: 200,
        requestType: 'dom_element',
        timestamp: Date.now(),
        source: 'DOM',
        dimensions: null,
        thumbnail: null,
      });
    }
  }

  // 4. Scan <a> media links
  const mediaLinkRegex =
    /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|mp4|webm|mov|m4v|mkv|avi|mp3|wav|ogg|m4a|aac|flac|pdf|m3u8|mpd)(\?|#|$)/i;
  const links = document.querySelectorAll('a[href]');
  for (const a of links) {
    const rawHref = a.getAttribute('href');
    if (!rawHref) continue;

    if (mediaLinkRegex.test(rawHref)) {
      const absUrl = toAbsolute(rawHref);
      if (!absUrl) continue;

      let type = 'Other';
      if (/\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)(\?|#|$)/i.test(absUrl)) type = 'Image';
      else if (/\.(mp4|webm|mov|m4v|mkv|avi)(\?|#|$)/i.test(absUrl)) type = 'Video';
      else if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i.test(absUrl)) type = 'Audio';
      else if (/\.pdf(\?|#|$)/i.test(absUrl)) type = 'Document';
      else if (/\.(m3u8|mpd)(\?|#|$)/i.test(absUrl)) type = 'Stream';

      const text = a.innerText?.trim();
      const fallback = a.download || a.title || (text && text.length < 50 ? text : null);

      addResource({
        id: `dom_${absUrl}`,
        url: absUrl,
        name: fallback || extractFileName(absUrl, type.toLowerCase()),
        mime: type === 'Document' ? 'application/pdf' : '',
        type,
        format: getFormatFromUrl(absUrl, type),
        size: null,
        status: 200,
        requestType: 'dom_element',
        timestamp: Date.now(),
        source: 'DOM',
        dimensions: null,
        thumbnail: type === 'Image' ? absUrl : null,
      });
    }
  }

  // 5. Scan <embed> and <object>
  const embeds = document.querySelectorAll('embed[src], object[data]');
  for (const el of embeds) {
    const raw = el.getAttribute('src') || el.getAttribute('data');
    const absUrl = toAbsolute(raw);
    if (!absUrl) continue;

    const type = absUrl.includes('.pdf') ? 'Document' : 'Other';
    addResource({
      id: `dom_${absUrl}`,
      url: absUrl,
      name: extractFileName(absUrl, 'document'),
      mime: type === 'Document' ? 'application/pdf' : '',
      type,
      format: getFormatFromUrl(absUrl, type),
      size: null,
      status: 200,
      requestType: 'dom_element',
      timestamp: Date.now(),
      source: 'DOM',
      dimensions: null,
      thumbnail: null,
    });
  }

  // 6. CSS Background Images
  const bgElements = document.querySelectorAll('[style*="background-image"], [style*="background:"]');
  for (const el of bgElements) {
    const style = el.getAttribute('style') || '';
    const matches = style.matchAll(/url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
    for (const match of matches) {
      const raw = match[1];
      const absUrl = toAbsolute(raw);
      if (!absUrl) continue;

      addResource({
        id: `dom_${absUrl}`,
        url: absUrl,
        name: extractFileName(absUrl, 'background_image'),
        mime: '',
        type: 'Image',
        format: getFormatFromUrl(absUrl, 'Image'),
        size: null,
        status: 200,
        requestType: 'dom_element',
        timestamp: Date.now(),
        source: 'DOM',
        dimensions: null,
        thumbnail: absUrl,
      });
    }
  }

  // 7. OpenGraph and Twitter Meta Tags
  const metaTags = document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]');
  for (const m of metaTags) {
    const prop = (m.getAttribute('property') || m.getAttribute('name') || '').toLowerCase();
    const content = m.getAttribute('content');
    if (!content) continue;

    let type = null;
    if (prop === 'og:image' || prop === 'twitter:image') type = 'Image';
    else if (prop === 'og:video' || prop === 'twitter:player:stream') type = 'Video';
    else if (prop === 'og:audio') type = 'Audio';

    if (type) {
      const absUrl = toAbsolute(content);
      if (!absUrl) continue;

      addResource({
        id: `dom_${absUrl}`,
        url: absUrl,
        name: extractFileName(absUrl, `${type.toLowerCase()}_meta`),
        mime: '',
        type,
        format: getFormatFromUrl(absUrl, type),
        size: null,
        status: 200,
        requestType: 'dom_element',
        timestamp: Date.now(),
        source: 'DOM',
        dimensions: null,
        thumbnail: type === 'Image' ? absUrl : null,
      });
    }
  }

  return Array.from(mediaMap.values());
}

/* --------------------------------------------------
   Scanning Coordination
-------------------------------------------------- */

async function scanTabMedia(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    throw new Error('Tab not found or closed.');
  }

  const url = tab.url || '';
  if (
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://') ||
    url.startsWith('devtools://') ||
    url.startsWith('edge://') ||
    url.startsWith('about:') ||
    url.startsWith('view-source:') ||
    url.includes('chromewebstore.google.com')
  ) {
    return {
      success: true,
      media: Array.from((await hydrateTab(tabId)).values()),
      warning: 'Chrome internal pages cannot be scanned for media.',
    };
  }

  const cleanUrl = stripUrlHash(url);
  const previousUrl = tabUrlStore.get(tabId);
  if (cleanUrl && previousUrl && previousUrl !== cleanUrl) {
    await clearTab(tabId);
  }
  if (cleanUrl) {
    tabUrlStore.set(tabId, cleanUrl);
  }

  // On supported platforms (YouTube, X.com, Instagram), invoke companion yt-dlp
  // so the official high-quality video/audio formats are extracted and placed first.
  if (isYtDlpPlatform(url)) {
    try {
      await extractViaCompanionForTab(tabId, url);
    } catch (companionErr) {
      console.warn('MediaHunter: companion extraction error', companionErr);
    }
  }

  let domMedia = null;
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'SCAN_DOM' });
    if (response?.success && Array.isArray(response.media)) {
      domMedia = response.media;
    }
  } catch {
    // Content script not ready; fallback to executeScript
  }

  if (!domMedia) {
    try {
      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId, allFrames: false },
        func: inPageScanner,
      });

      if (injectionResults && injectionResults[0]?.result) {
        domMedia = injectionResults[0].result;
      }
    } catch (err) {
      console.warn('MediaHunter: executeScript failed', err);
    }
  }

  if (Array.isArray(domMedia)) {
    for (const item of domMedia) {
      addOrUpdateItemSync(tabId, item);
    }
  }

  await persistTab(tabId);
  const currentItems = sortMediaWithYtDlpFirst(Array.from((await hydrateTab(tabId)).values()));

  return {
    success: true,
    media: currentItems,
  };
}

/* --------------------------------------------------
   Browser Downloads Handling
-------------------------------------------------- */

async function handleDownload(request) {
  const { url, filename } = request;

  if (!url || typeof url !== 'string') {
    return { success: false, error: 'Download URL is required.' };
  }

  const trimmedUrl = url.trim();

  // Validate URL protocol scheme for security
  if (!/^https?:\/\//i.test(trimmedUrl) && !/^data:(image|video|audio)\//i.test(trimmedUrl)) {
    return {
      success: false,
      error: 'Security error: only HTTP, HTTPS, or safe data: URLs can be downloaded.',
    };
  }

  // Check if it's a streaming manifest that cannot be downloaded as standalone file
  if (
    trimmedUrl.includes('.m3u8') ||
    trimmedUrl.includes('.mpd') ||
    request.type === 'Stream'
  ) {
    return {
      success: false,
      error: 'Streaming manifests (.m3u8 / .mpd) cannot be saved as standalone media files.',
    };
  }

  // Disallow blob: URLs since they are in-memory streams and cannot be downloaded
  if (trimmedUrl.startsWith('blob:')) {
    return {
      success: false,
      error: 'blob: URLs are temporary in-memory streams and cannot be downloaded as standalone files.',
    };
  }

  const format = getFormat(trimmedUrl);
  const cleanFilename = sanitizeFilename(filename || getFileNameFromUrl(trimmedUrl), format);

  try {
    const downloadId = await chrome.downloads.download({
      url: trimmedUrl,
      filename: cleanFilename,
      saveAs: false,
    });

    return { success: true, downloadId };
  } catch (err) {
    return {
      success: false,
      error: err?.message || 'Download could not be initiated by Chrome.',
    };
  }
}

/* --------------------------------------------------
   Message Router
-------------------------------------------------- */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  // Verify that the message originates from this extension (popup, options, or content script)
  if (sender.id && sender.id !== chrome.runtime.id) {
    return false;
  }

  const tabId = message.tabId || sender?.tab?.id;

  switch (message.type) {
    case 'SCAN_TAB': {
      if (!tabId) {
        sendResponse({ success: false, error: 'tabId is required for SCAN_TAB.' });
        return true;
      }

      scanTabMedia(tabId)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case 'GET_MEDIA': {
      if (!tabId) {
        sendResponse({ success: false, error: 'tabId is required for GET_MEDIA.' });
        return true;
      }

      hydrateTab(tabId)
        .then((map) => {
          sendResponse({
            success: true,
            media: sortMediaWithYtDlpFirst(Array.from(map.values())),
          });
        })
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case 'DOWNLOAD_MEDIA': {
      handleDownload(message)
        .then((result) => sendResponse(result))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case 'CLEAR_MEDIA': {
      if (!tabId) {
        sendResponse({ success: false, error: 'tabId is required for CLEAR_MEDIA.' });
        return true;
      }

      clearTab(tabId)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case 'PAGE_MEDIA_DETECTED': {
      if (!tabId || !Array.isArray(message.media)) {
        sendResponse({ success: false });
        return true;
      }

      for (const item of message.media) {
        if (!item || typeof item.url !== 'string') continue;
        const trimmed = item.url.trim();
        // Only accept HTTP(S) or valid safe data URIs, disallow blob: and javascript:
        if (!/^https?:\/\//i.test(trimmed) && !/^data:(image|video|audio)\//i.test(trimmed)) {
          continue;
        }
        addOrUpdateItemSync(tabId, item);
      }
      sendResponse({ success: true });
      return true;
    }

    default:
      return false;
  }
});

/* --------------------------------------------------
   Tab Lifecycle Management
-------------------------------------------------- */

chrome.tabs.onRemoved.addListener((tabId) => {
  tabUrlStore.delete(tabId);
  clearTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const currentUrl = tab?.url || changeInfo.url || '';
  const cleanUrl = stripUrlHash(currentUrl);
  const previousUrl = tabUrlStore.get(tabId);
  const urlChanged = Boolean(cleanUrl && previousUrl !== cleanUrl && (changeInfo.url || changeInfo.status === 'loading'));

  // Reset tab media on full navigation or SPA URL change (e.g. YouTube/X/Instagram)
  if (urlChanged) {
    tabUrlStore.set(tabId, cleanUrl);
    clearTab(tabId).then(() => {
      debouncedNotifyTab(tabId);
      if (isYtDlpPlatform(currentUrl)) {
        extractViaCompanionForTab(tabId, currentUrl);
      }
    }).catch(() => {});
  } else if (changeInfo.status === 'loading' && currentUrl && isYtDlpPlatform(currentUrl)) {
    // Pre-fetch via yt-dlp companion for supported platforms (YouTube, X, Instagram)
    // so the media items are ready immediately as the first results
    tabUrlStore.set(tabId, cleanUrl);
    extractViaCompanionForTab(tabId, currentUrl);
  }

  // Inject the XHR interceptor into the MAIN world as early as possible.
  // chrome.scripting.executeScript with world:'MAIN' runs synchronously inline
  // (like a classic <script> tag), which is earlier than the content script's
  // async src= script tag injection. This maximises the chance of hooking
  // fetch/XHR before the page's player JS fires.
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete') {
    const url = currentUrl;
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://') || url.startsWith('about:')) {
      return;
    }
    chrome.scripting.executeScript({
      target: { tabId, allFrames: false },
      files: ['xhr-interceptor.js'],
      world: 'MAIN',
    }).catch(() => {
      // Silently ignore: restricted pages (chrome://, PDFs, etc.) will fail here
    });
  }
});
