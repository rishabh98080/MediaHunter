/**
 * MediaHunter - Content Script
 * 
 * Injected into web pages (ISOLATED world) to:
 * 1. Scan DOM media elements (images, videos, audio, documents, streams)
 * 2. Inject xhr-interceptor.js into the page MAIN world to hook XHR/fetch
 *    and capture real CDN URLs from X/Twitter, Instagram, YouTube, TikTok,
 *    Reddit *before* they are piped into MediaSource (becoming blob: URLs)
 * 3. Observe dynamically loaded media via MutationObserver + scroll
 * 4. Support page-context blob: URL extraction and downloads (fallback)
 */

(function () {
  'use strict';

  // Prevent duplicate registration if script is injected multiple times
  if (window.__mediaHunterContentScriptLoaded) {
    return;
  }
  window.__mediaHunterContentScriptLoaded = true;

  const observedUrls = new Set();
  let mutationTimeout = null;
  let scrollTimeout = null;

  /* -------------------------------------------------------
     Inject XHR/fetch interceptor into the page's MAIN world
     so it can hook window.fetch and XMLHttpRequest before
     any MediaSource pipeline is set up.
     
     This is done by injecting a <script> tag pointing to
     xhr-interceptor.js — which runs in the page's own JS
     context (not the isolated content-script sandbox).
     The interceptor posts captured media URLs back via a
     custom DOM event which we listen to below.
  ------------------------------------------------------- */

  /**
   * Inject the XHR/fetch interceptor into the page's MAIN world.
   *
   * Strategy: We use TWO methods to maximize coverage:
   *   1. Inline script injection — fastest, runs synchronously when DOM is ready.
   *      This is a <script> tag whose src points to xhr-interceptor.js.
   *      Runs as soon as the browser processes the tag (before deferred scripts).
   *   2. The service worker also injects via chrome.scripting.executeScript with
   *      world:'MAIN' on tabs.onUpdated — catches pages already open.
   *
   * NOTE: Even with document_start, the script tag's src= loading is still
   * async (the browser must fetch the extension file). Twitter/YouTube's player
   * JS is bundled inline and runs synchronously during HTML parse, so it always
   * beats an async src= injection. The webRequest observer in service-worker.js
   * is the reliable fallback for those — it sees every network request regardless.
   *
   * The XHR hook is still valuable for catching requests AFTER the initial load
   * (e.g. next video in a feed, lazy-loaded embeds).
   */
  function injectXhrInterceptor() {
    if (document.__mediaHunterInterceptorInjected) return;
    document.__mediaHunterInterceptorInjected = true;

    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('xhr-interceptor.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch {
      // Restricted page (e.g. chrome://) — ignore
    }
  }

  // Run immediately regardless of readyState; appendChild will work as long as
  // documentElement exists (always true at document_start).
  injectXhrInterceptor();

  // Bridge: listen for media URLs detected by the MAIN-world interceptor
  // and forward them to the background service worker
  document.addEventListener('__mediahunter_url_found__', (event) => {
    try {
      if (!event.detail || typeof event.detail !== 'string') return;
      const item = JSON.parse(event.detail);
      if (!item || typeof item !== 'object' || typeof item.url !== 'string') return;
      
      const trimmed = item.url.trim();
      if (!/^https?:\/\//i.test(trimmed) && !/^data:(?:image|video|audio)\//i.test(trimmed)) {
        return;
      }
      item.url = trimmed;

      // Only report URLs we haven't seen yet
      if (!observedUrls.has(item.url)) {
        observedUrls.add(item.url);
        chrome.runtime.sendMessage({
          type: 'PAGE_MEDIA_DETECTED',
          media: [item],
        }).catch(() => {});
      }
    } catch {
      // ignore parse errors
    }
  });

  /**
   * Helper to resolve a URL to an absolute URL
   */
  function toAbsolute(rawUrl, baseURI) {
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
      const resolved = new URL(trimmed, baseURI || document.baseURI || window.location.href);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:' && resolved.protocol !== 'data:') {
        return null;
      }
      return resolved.href;
    } catch {
      return null;
    }
  }

  /**
   * Helper to extract a friendly filename from URL, with special support for blob: URLs
   */
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
      if (last) {
        return decodeURIComponent(last);
      }
    } catch {
      // ignore
    }
    return fallback || 'media_resource';
  }

  /**
   * Extract file extension/format from URL or default by media type
   */
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

  /**
   * Scan current DOM for media elements and return normalized items
   */
  function scanDOM() {
    const mediaMap = new Map();
    const baseURI = document.baseURI || window.location.href;

    function addResource(item) {
      if (!item || !item.url) return;
      const url = item.url;
      // Skip all blob: URLs completely since they cannot be downloaded
      if (url.startsWith('blob:')) return;
      // Skip trivial tracking data URLs
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

    // 1. Scan Images (<img>, <picture source>, data-src, srcset)
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
      if (el.getAttribute('data-high-res-src')) urls.add(el.getAttribute('data-high-res-src'));

      // Check srcset
      const srcset = el.srcset || el.getAttribute('data-srcset');
      if (srcset) {
        const candidates = srcset.split(',');
        for (const candidate of candidates) {
          const u = candidate.trim().split(/\s+/)[0];
          if (u) urls.add(u);
        }
      }

      // Filter out 1x1 tracking pixels
      const width = el.naturalWidth || el.width || 0;
      const height = el.naturalHeight || el.height || 0;
      if (width === 1 && height === 1) continue;

      const dimensions = width > 0 && height > 0 ? `${width}x${height}` : null;
      const fallbackName = el.alt || el.title || null;

      for (const raw of urls) {
        const absUrl = toAbsolute(raw, baseURI);
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

    // 2. Scan Videos (<video>, child <source>, posters)
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
      const poster = toAbsolute(v.poster, baseURI);
      const title = v.title || v.getAttribute('aria-label') || null;

      for (const raw of urls) {
        const absUrl = toAbsolute(raw, baseURI);
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

      // Record poster as an image if present
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

    // 3. Scan Audio (<audio>, child <source>)
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
        const absUrl = toAbsolute(raw, baseURI);
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

    // 4. Scan <a> links pointing to downloadable media
    const mediaLinkRegex =
      /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp|mp4|webm|mov|m4v|mkv|avi|mp3|wav|ogg|m4a|aac|flac|pdf|m3u8|mpd)(\?|#|$)/i;
    const links = document.querySelectorAll('a[href]');
    for (const a of links) {
      const rawHref = a.getAttribute('href');
      if (!rawHref) continue;

      if (mediaLinkRegex.test(rawHref)) {
        const absUrl = toAbsolute(rawHref, baseURI);
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
      const absUrl = toAbsolute(raw, baseURI);
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

    // 6. CSS Background images (e.g. style="background-image: url(...)")
    const bgElements = document.querySelectorAll('[style*="background-image"], [style*="background:"]');
    for (const el of bgElements) {
      const style = el.getAttribute('style') || '';
      const matches = style.matchAll(/url\s*\(\s*['"]?([^'")]+)['"]?\s*\)/gi);
      for (const match of matches) {
        const raw = match[1];
        const absUrl = toAbsolute(raw, baseURI);
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
        const absUrl = toAbsolute(content, baseURI);
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

  /**
   * In-page blob download handler
   */
  async function handleBlobDownloadInPage(blobUrl, targetFilename) {
    try {
      const response = await fetch(blobUrl);
      if (!response || (!response.ok && response.status !== 0 && response.status !== 200)) {
        throw new Error(`HTTP error ${response?.status}`);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        return {
          success: false,
          error: 'Blob resource is empty or is a streaming MediaSource that cannot be downloaded as a single file.',
        };
      }

      const mime = blob.type || '';
      const size = blob.size;

      // Small to medium blobs: convert to Data URL
      if (size <= 25 * 1024 * 1024 && typeof FileReader !== 'undefined') {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Failed to read blob'));
          reader.readAsDataURL(blob);
        });

        return {
          success: true,
          method: 'data_url',
          dataUrl,
          mimeType: mime,
          size,
        };
      }

      // Large blobs: trigger anchor download
      const root = document.body || document.documentElement;
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = targetFilename || 'download';
      a.style.display = 'none';
      root.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(objectUrl);
      }, 5000);

      return {
        success: true,
        method: 'anchor',
        mimeType: mime,
        size,
      };
    } catch {
      // Fallback directly to anchor on the blobUrl
      try {
        const root = document.body || document.documentElement;
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = targetFilename || 'download';
        a.style.display = 'none';
        root.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 1000);
        return { success: true, method: 'anchor' };
      } catch (e) {
        return {
          success: false,
          error: e?.message || 'Unable to read blob resource. It may be an active MediaSource stream or expired.',
        };
      }
    }
  }

  /**
   * Send discovered media to background service worker
   */
  function reportDiscoveredMedia(items) {
    if (!items || !items.length) return;

    const newItems = [];
    for (const item of items) {
      if (!observedUrls.has(item.url)) {
        observedUrls.add(item.url);
        newItems.push(item);
      }
    }

    if (newItems.length > 0) {
      try {
        chrome.runtime.sendMessage({
          type: 'PAGE_MEDIA_DETECTED',
          media: newItems,
        }).catch(() => {
          // Extension context may be unloaded or worker asleep
        });
      } catch {
        // ignore
      }
    }
  }

  /**
   * Debounced scan helper for dynamic page activity
   */
  function handleDynamicUpdate() {
    clearTimeout(mutationTimeout);
    mutationTimeout = setTimeout(() => {
      const results = scanDOM();
      reportDiscoveredMedia(results);
    }, 450);
  }

  // Initial scan on load
  const initialMedia = scanDOM();
  reportDiscoveredMedia(initialMedia);

  // Message listener for SCAN_DOM and DOWNLOAD_BLOB from background service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'SCAN_DOM') {
      const media = scanDOM();
      reportDiscoveredMedia(media);
      sendResponse({ success: true, media });
      return true;
    }

    if (message?.type === 'DOWNLOAD_BLOB') {
      handleBlobDownloadInPage(message.url, message.filename)
        .then((res) => sendResponse(res))
        .catch((err) => sendResponse({ success: false, error: err?.message || 'Blob download failed' }));
      return true;
    }
  });

  // Observe DOM additions (e.g. infinite scroll on YouTube, Instagram, X/Twitter, Reddit, TikTok)
  const observer = new MutationObserver(() => {
    handleDynamicUpdate();
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'data-src', 'srcset', 'data-srcset', 'poster'],
    });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'data-src', 'srcset', 'data-srcset', 'poster'],
      });
      handleDynamicUpdate();
    });
  }

  // Scroll listener with debounce for lazy loading
  window.addEventListener(
    'scroll',
    () => {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        handleDynamicUpdate();
      }, 500);
    },
    { passive: true }
  );
})();
