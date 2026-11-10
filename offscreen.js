/**
 * MediaHunter – Offscreen Document (offscreen.js)
 *
 * Runs inside a hidden HTML document that has full DOM access.
 * Used to fetch blob: URLs (which are origin-scoped to pages, not to the
 * extension's service worker) and convert them to data: URLs that the
 * service worker can pass to chrome.downloads.download().
 *
 * Message protocol:
 *   Request  → { target: 'offscreen', type: 'FETCH_BLOB', url, filename, mimeHint }
 *   Response → { success: true,  dataUrl, mimeType, size, filename }
 *            | { success: false, error }
 */

'use strict';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  if (message.type === 'FETCH_BLOB') {
    handleFetchBlob(message)
      .then(sendResponse)
      .catch((err) => sendResponse({ success: false, error: err?.message || 'Unknown error in offscreen document' }));
    return true; // keep message channel open for async response
  }

  return false;
});

/**
 * Fetch a blob: (or any) URL in the offscreen DOM context, read it as a
 * data URL, and return metadata the service worker needs to call
 * chrome.downloads.download({ url: dataUrl, filename }).
 *
 * For blobs larger than 25 MB we fall back to triggering a hidden <a> click
 * directly in the offscreen document (which has a real document body).
 */
async function handleFetchBlob({ url, filename, mimeHint }) {
  if (!url) {
    return { success: false, error: 'No URL provided to offscreen fetch handler.' };
  }

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    return {
      success: false,
      error: `Failed to fetch blob URL: ${err?.message || 'Network error'}. The blob may have expired or is from a closed/restricted tab.`,
    };
  }

  if (!response.ok && response.status !== 0) {
    return { success: false, error: `Fetch failed with HTTP ${response.status}` };
  }

  let blob;
  try {
    blob = await response.blob();
  } catch (err) {
    return { success: false, error: `Failed to read blob body: ${err?.message}` };
  }

  if (!blob || blob.size === 0) {
    return {
      success: false,
      error: 'Blob resource is empty. This is usually a streaming MediaSource (e.g. YouTube/Netflix player) that cannot be saved as a single file.',
    };
  }

  const mimeType = blob.type || mimeHint || 'application/octet-stream';
  const size = blob.size;
  const cleanFilename = resolveFilename(filename, mimeType);

  // ≤ 25 MB: convert to data URL so the service worker can pass it to
  // chrome.downloads.download() – the only method that works from SW context.
  if (size <= 25 * 1024 * 1024) {
    const dataUrl = await blobToDataUrl(blob);
    return { success: true, dataUrl, mimeType, size, filename: cleanFilename };
  }

  // > 25 MB: anchor-click inside the offscreen document.
  // The offscreen document has a real DOM, so this actually works.
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = cleanFilename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(objectUrl);
  }, 10_000);

  return { success: true, method: 'offscreen_anchor', mimeType, size, filename: cleanFilename };
}

/** Convert a Blob to a base64 data: URL. */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(/** @type {string} */ (reader.result));
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}

/** Determine a good filename, appending the right extension from MIME if needed. */
function resolveFilename(filename, mimeType) {
  const mimeToExt = {
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/ogg': 'ogv',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'audio/aac': 'aac',
    'audio/m4a': 'm4a',
    'audio/flac': 'flac',
    'application/pdf': 'pdf',
  };

  const baseMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  const ext = mimeToExt[baseMime] || baseMime.split('/')[1] || null;

  let name = (filename || 'media_download').trim().replace(/[<>:"/\\|?*]/g, '_');
  name = name.replace(/^_+|_+$/g, '') || 'media_download';

  if (ext && !name.toLowerCase().endsWith(`.${ext}`)) {
    if (!name.includes('.')) {
      name = `${name}.${ext}`;
    }
  }

  return name;
}

