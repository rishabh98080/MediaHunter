
import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";

/* --------------------------------------------------
   Chrome extension helpers
-------------------------------------------------- */

const isExtension =
  typeof chrome !== "undefined" &&
  Boolean(chrome.runtime?.id) &&
  Boolean(chrome.tabs);

const CATEGORIES = [
  "All",
  "Images",
  "Videos",
  "Audio",
  "Documents",
  "Streams",
];

const CATEGORY_ICONS = {
  All: "▦",
  Images: "▧",
  Videos: "▶",
  Audio: "♫",
  Documents: "▤",
  Streams: "◉",
};

function getFileName(url) {
  try {
    const pathname = new URL(url).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(name || "Unnamed resource");
  } catch {
    return "Unnamed resource";
  }
}

function getMediaType(mimeType = "", url = "") {
  const mime = mimeType.toLowerCase();
  const pathname = url.split("?")[0].toLowerCase();

  if (
    mime.includes("image/") ||
    /\.(jpg|jpeg|png|gif|webp|svg|avif|bmp)$/.test(pathname)
  ) {
    return "Image";
  }

  if (
    mime.includes("video/") ||
    /\.(mp4|webm|mov|m4v|mkv|avi)$/.test(pathname)
  ) {
    return "Video";
  }

  if (
    mime.includes("audio/") ||
    /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(pathname)
  ) {
    return "Audio";
  }

  if (
    mime.includes("pdf") ||
    /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/.test(pathname)
  ) {
    return "Document";
  }

  if (
    mime.includes("mpegurl") ||
    mime.includes("dash+xml") ||
    /\.(m3u8|mpd)$/.test(pathname)
  ) {
    return "Stream";
  }

  return "Other";
}

function getFormat(url, mimeType = "") {
  const extension = url
    .split("?")[0]
    .split(".")
    .pop();

  if (extension && extension !== url && extension.length <= 6) {
    return extension.toUpperCase();
  }

  return mimeType.split("/").pop()?.toUpperCase() || "UNKNOWN";
}

function formatSize(bytes) {
  const value = Number(bytes);

  if (!Number.isFinite(value) || value <= 0) {
    return "Unknown";
  }

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MB`;
  }

  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function normalizeResource(resource, index) {
  const url = resource.url || resource.src || "";

  const mime =
    resource.mimeType ||
    resource.mime ||
    resource.contentType ||
    "";

  const type = getMediaType(mime, url);

  const contentLength =
    resource.contentLength ??
    resource.size ??
    resource.fileSize ??
    null;

  const numericSize = Number(contentLength);

  return {
    id: resource.id || `${url}-${index}`,
    url,
    name: resource.name || resource.filename || getFileName(url),
    mime,
    type,
    format: getFormat(url, mime),
    size: Number.isFinite(numericSize) ? numericSize : null,
    status: resource.status ?? resource.statusCode ?? null,
    requestType: resource.requestType || resource.type || "Unknown",
    timestamp: resource.timestamp || resource.timeStamp || null,
    source: resource.source || "Network",
    dimensions: resource.dimensions || null,
    thumbnail: resource.thumbnail || null,
  };
}

/* --------------------------------------------------
   Inline icons
-------------------------------------------------- */

function Icon({ name, size = 18 }) {
  const paths = {
    cloud: (
      <>
        <path d="M20 16.2A4.8 4.8 0 0 0 18 7h-1.2A7 7 0 1 0 4 15.3" />
        <path d="M12 12v9m-4-4 4 4 4-4" />
      </>
    ),
    folder: (
      <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    ),
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5" />
        <path d="M4 17v4h16v-4" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1 0 2Z" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    link: (
      <>
        <path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 3l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.1 0l-3 3A5 5 0 0 0 11 21l1.7-1.7" />
      </>
    ),
    info: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 11v5m0-8h.01" />
      </>
    ),
    trash: (
      <path d="M3 6h18m-2 0-1 14H6L5 6m4 0V3h6v3m-5 4v6m4-6v6" />
    ),
    external: (
      <>
        <path d="M14 3h7v7m0-7-9 9" />
        <path d="M19 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h6" />
      </>
    ),
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    list: (
      <path d="M9 5h12M9 12h12M9 19h12M4 5h.01M4 12h.01M4 19h.01" />
    ),
    filter: <path d="M4 5h16l-6 7v6l-4 2v-8z" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    play: <path d="m8 5 12 7-12 7z" />,
    close: <path d="m18 6-12 12M6 6l12 12" />,
    chevron: <path d="m7 10 5 5 5-5" />,
    sort: <path d="M4 7h16M7 12h10m-7 5h4" />,
    pulse: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

/* --------------------------------------------------
   Main application
-------------------------------------------------- */

function App() {
  const [media, setMedia] = useState([]);
  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [activePanel, setActivePanel] = useState("Preview");
  const [menuId, setMenuId] = useState(null);
  const [sort, setSort] = useState("Default");
  const [view, setView] = useState("list");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  /* -----------------------------------------------
     Buy Me a Coffee / PayPal state & handlers
  ------------------------------------------------ */
  const PAYPAL_HANDLE = "RishabhKumar484874";

  const [showCoffeeModal, setShowCoffeeModal] = useState(false);
  const [coffeeAmount, setCoffeeAmount] = useState(5);
  const [customAmount, setCustomAmount] = useState("");

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(notify.timer);
    notify.timer = window.setTimeout(() => setToast(""), 2600);
  }, []);

  const handlePaypalDonate = () => {
    const parsed = parseFloat(customAmount);
    const amountVal = (!isNaN(parsed) && parsed > 0) ? parsed : coffeeAmount;
    if (!amountVal || isNaN(amountVal) || amountVal <= 0) {
      notify("Please choose or enter a valid donation amount.");
      return;
    }

    const paypalUrl = `https://paypal.me/${PAYPAL_HANDLE}/${amountVal}`;

    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: paypalUrl });
    } else {
      window.open(paypalUrl, "_blank", "noopener,noreferrer");
    }

    notify(`Redirecting to PayPal for $${amountVal} coffee... Thank you! ☕`);
    setShowCoffeeModal(false);
  };

  /* -----------------------------------------------
     Load media from the background service worker
  ------------------------------------------------ */

  const loadMedia = useCallback(async (shouldScan = false) => {
    if (!isExtension) {
      setError("Open MediaHunter from Chrome's Extensions menu.");
      return;
    }

    try {
      setLoading(true);
      setError("");

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        throw new Error("No active browser tab found.");
      }

      if (shouldScan) {
        await chrome.runtime.sendMessage({
          type: "SCAN_TAB",
          tabId: tab.id,
        });
      }

      const response = await chrome.runtime.sendMessage({
        type: "GET_MEDIA",
        tabId: tab.id,
      });

      if (response?.success === false) {
        throw new Error(response.error || "Unable to retrieve media.");
      }

      // Support either an array or { success, media } response.
      const resources = Array.isArray(response)
        ? response
        : response?.media || response?.resources || [];

      const normalized = resources
        .filter((item) => item?.url || item?.src)
        .map(normalizeResource);

      setMedia(normalized);

      setSelected((previous) =>
        previous.filter((id) =>
          normalized.some((item) => item.id === id)
        )
      );

      setActiveItem((previous) => {
        if (normalized.some((item) => item.id === previous)) {
          return previous;
        }

        return normalized[0]?.id ?? null;
      });
    } catch (err) {
      console.error("MediaHunter: failed to load media", err);
      setError(err.message || "Failed to load media.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isExtension) {
      setError("Open MediaHunter from Chrome's Extensions menu.");
      return;
    }

    loadMedia(true);

    const handleMessage = (message) => {
      if (message?.type === "MEDIA_UPDATED") {
        loadMedia(false);
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);

    return () => {
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, [loadMedia]);

  /* -----------------------------------------------
     Filtering and sorting
  ------------------------------------------------ */

  const filteredMedia = useMemo(() => {
    let items = media.filter((item) => {
      const matchesCategory =
        category === "All" ||
        (category === "Images" && item.type === "Image") ||
        (category === "Videos" && item.type === "Video") ||
        (category === "Audio" && item.type === "Audio") ||
        (category === "Documents" && item.type === "Document") ||
        (category === "Streams" && item.type === "Stream");

      const matchesSearch =
        `${item.name} ${item.type} ${item.format} ${item.url}`
          .toLowerCase()
          .includes(search.toLowerCase());

      return matchesCategory && matchesSearch;
    });

    if (sort === "Name") {
      items = [...items].sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    }

    if (sort === "Size ↓") {
      items = [...items].sort(
        (a, b) => (b.size || 0) - (a.size || 0)
      );
    }

    if (sort === "Size ↑") {
      items = [...items].sort(
        (a, b) => (a.size || 0) - (b.size || 0)
      );
    }

    return items;
  }, [media, category, search, sort]);

  const currentItem =
    media.find((item) => item.id === activeItem) || null;

  const selectedItems = media.filter((item) =>
    selected.includes(item.id)
  );

  const toggleSelect = (id) => {
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id]
    );
  };

  const selectAll = () => {
    const visibleIds = filteredMedia.map((item) => item.id);
    const allSelected =
      visibleIds.length > 0 &&
      visibleIds.every((id) => selected.includes(id));

    setSelected((previous) =>
      allSelected
        ? previous.filter((id) => !visibleIds.includes(id))
        : [...new Set([...previous, ...visibleIds])]
    );
  };

  /* -----------------------------------------------
     Actions
  ------------------------------------------------ */

  const copyLink = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copied to clipboard");
    } catch {
      notify("Unable to copy link");
    }

    setMenuId(null);
  };

  const downloadItem = async (item) => {
    if (!isExtension) {
      notify("Chrome Downloads API is unavailable.");
      return;
    }

    if (!item?.url) {
      notify("Resource URL is missing.");
      return;
    }

    if (item.type === "Stream") {
      notify("Streaming manifests are detected but not directly downloadable.");
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_MEDIA",
        url: item.url,
        filename: item.name,
      });

      if (response?.success === false) {
        throw new Error(response.error || "Download failed.");
      }

      notify(`Download requested: ${item.name}`);
    } catch (err) {
      console.error("MediaHunter download error:", err);
      notify(err.message || "Download could not be started.");
    }
  };

  const downloadSelected = () => {
    if (!selectedItems.length) {
      notify("Select at least one media file.");
      return;
    }

    selectedItems.forEach(downloadItem);
  };

  const removeItem = (id) => {
    setMedia((previous) =>
      previous.filter((item) => item.id !== id)
    );

    setSelected((previous) =>
      previous.filter((item) => item !== id)
    );

    if (activeItem === id) {
      const next = media.find((item) => item.id !== id);
      setActiveItem(next?.id ?? null);
    }

    setMenuId(null);
    notify("Removed from current view");
  };

  const openProperties = (item) => {
    setActiveItem(item.id);
    setActivePanel("Properties");
    setMenuId(null);
  };

  const openResource = (url) => {
    if (!url || typeof url !== "string") return;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed) && !/^data:(?:image|video|audio)\//i.test(trimmed)) {
      notify("Cannot open unsupported or unsafe URL scheme");
      return;
    }
    if (typeof chrome !== "undefined" && chrome.tabs?.create) {
      chrome.tabs.create({ url: trimmed });
    } else {
      window.open(trimmed, "_blank", "noopener,noreferrer");
    }
  };

  /* -----------------------------------------------
     Thumbnail
  ------------------------------------------------ */

  const renderThumbnail = (item, large = false) => {
    if (item.thumbnail) {
      return (
        <img
          className={`thumbnail-image ${large ? "large" : ""}`}
          src={item.thumbnail}
          alt={item.name}
          loading="lazy"
        />
      );
    }

    const symbols = {
      Image: "▧",
      Video: "▶",
      Audio: "♫",
      Document: "PDF",
      Stream: "◉",
      Other: "◇",
    };

    return (
      <div className={`thumbnail-placeholder ${item.type.toLowerCase()}`}>
        <span>{symbols[item.type] || "◇"}</span>
      </div>
    );
  };

  const renderItemMenu = (item) => (
    <div className="context-menu">
      <button
        className="danger-action"
        onClick={() => removeItem(item.id)}
      >
        <Icon name="trash" /> Remove
      </button>

      <button onClick={() => openProperties(item)}>
        <Icon name="info" /> Properties
      </button>

      <button onClick={() => copyLink(item.url)}>
        <Icon name="link" /> Copy Link
      </button>

      <button
        onClick={() => {
          openResource(item.url);
          setMenuId(null);
        }}
      >
        <Icon name="external" /> Open in New Tab
      </button>
    </div>
  );

  /* -----------------------------------------------
     Render
  ------------------------------------------------ */

  return (
    <div
      className="dashboard"
      onClick={() => menuId && setMenuId(null)}
    >
      <header className="top-header">
        <div className="brand">
          <div className="brand-logo">
            <Icon name="cloud" size={38} />
          </div>

          <div>
            <div className="brand-name">
              Media<span>Hunter</span>
              <small>v0.2.0</small>
            </div>

            <div className="brand-subtitle">
              Detect <b>•</b> Preview <b>•</b> Download
            </div>
          </div>
        </div>

        <div className="header-actions">
          <button
            className="coffee-button"
            title="Buy Me a Coffee (PayPal)"
            onClick={() => setShowCoffeeModal(true)}
          >
            <span className="coffee-emoji">☕</span>
            <span className="coffee-text">Buy me a coffee</span>
          </button>

          <button
            className="icon-button"
            title="Refresh scan"
            onClick={() => loadMedia(true)}
          >
            <Icon name="pulse" size={18} />
          </button>
        </div>
      </header>

      <nav className="category-bar">
        {CATEGORIES.map((item) => {
          const count =
            item === "All"
              ? media.length
              : media.filter((entry) => {
                  if (item === "Images") return entry.type === "Image";
                  if (item === "Videos") return entry.type === "Video";
                  if (item === "Audio") return entry.type === "Audio";
                  if (item === "Documents") return entry.type === "Document";
                  if (item === "Streams") return entry.type === "Stream";
                  return false;
                }).length;

          return (
            <button
              key={item}
              className={`category-tab ${
                category === item ? "active" : ""
              }`}
              onClick={() => setCategory(item)}
            >
              <span className="category-icon">
                {CATEGORY_ICONS[item]}
              </span>
              {item}
              <span className="category-count">{count}</span>
            </button>
          );
        })}
      </nav>

      <main className="workspace">
        <section className="media-section">
          <div className="list-toolbar">
            <div className="search-box">
              <Icon name="search" />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search files, types, names..."
              />

              {search && (
                <button onClick={() => setSearch("")}>
                  <Icon name="close" size={15} />
                </button>
              )}
            </div>

            <div className="view-switch">
              <button
                className={view === "grid" ? "active" : ""}
                onClick={() => setView("grid")}
                title="Grid view"
              >
                <Icon name="grid" />
              </button>

              <button
                className={view === "list" ? "active" : ""}
                onClick={() => setView("list")}
                title="List view"
              >
                <Icon name="list" />
              </button>
            </div>

            <label className="sort-select">
              <Icon name="sort" size={16} />

              <select
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option>Default</option>
                <option>Size ↓</option>
                <option>Size ↑</option>
                <option>Name</option>
              </select>

              <Icon name="chevron" size={14} />
            </label>
          </div>

          <div className="selection-toolbar">
            <label>
              <input
                type="checkbox"
                checked={
                  filteredMedia.length > 0 &&
                  filteredMedia.every((item) =>
                    selected.includes(item.id)
                  )
                }
                onChange={selectAll}
              />
              Select visible
            </label>

            <div className="selection-actions">
              {selected.length > 0 && (
                <button
                  type="button"
                  className="download-pill-btn"
                  onClick={downloadSelected}
                >
                  <Icon name="download" size={14} />
                  Download Selected ({selected.length})
                </button>
              )}

              <button onClick={() => loadMedia(true)} disabled={loading}>
                <Icon name="pulse" size={15} />
                {loading ? "Scanning..." : "Scan page"}
              </button>
            </div>
          </div>

          {error && (
            <div className="empty-state">
              <Icon name="info" size={30} />
              <h3>Unable to scan page</h3>
              <p>{error}</p>
            </div>
          )}

          <div className={`media-list ${view}`}>
            {!error &&
              filteredMedia.map((item) => (
                <article
                  key={item.id}
                  className={`media-card ${
                    selected.includes(item.id) ? "selected" : ""
                  } ${activeItem === item.id ? "focused" : ""}`}
                  onClick={() => setActiveItem(item.id)}
                >
                  <label
                    className="selection-box"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      onChange={() => toggleSelect(item.id)}
                      aria-label={`Select ${item.name}`}
                    />

                    <span>
                      <Icon name="check" size={14} />
                    </span>
                  </label>

                  <div className="media-thumbnail">
                    {renderThumbnail(item)}

                    {item.type === "Video" && (
                      <span className="play-overlay">
                        <Icon name="play" />
                      </span>
                    )}
                  </div>

                  <div className="media-info">
                    <div className="media-title-line">
                      <strong title={item.name}>{item.name}</strong>

                      <span
                        className={`type-badge ${item.type.toLowerCase()}`}
                      >
                        {item.type}
                      </span>

                      <span className="format-label">
                        {item.format}
                      </span>
                    </div>

                    <div className="media-metadata">
                      {item.size !== null && (
                        <span>{formatSize(item.size)}</span>
                      )}

                      {item.status !== null && (
                        <>
                          <i>•</i>
                          <span>HTTP {item.status}</span>
                        </>
                      )}

                      {item.mime && (
                        <>
                          <i>•</i>
                          <span>{item.mime}</span>
                        </>
                      )}
                    </div>

                    <button
                      className="media-url"
                      title={item.url}
                      onClick={(event) => {
                        event.stopPropagation();
                        copyLink(item.url);
                      }}
                    >
                      <Icon name="link" size={14} />
                      <span>{item.url}</span>
                    </button>
                  </div>

                  <div className="media-actions">
                    <button
                      className="row-download"
                      title="Download"
                      onClick={(event) => {
                        event.stopPropagation();
                        downloadItem(item);
                      }}
                    >
                      <Icon name="download" size={15} />
                    </button>

                    <div
                      className="menu-wrapper"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button
                        className="more-button"
                        title="More options"
                        onClick={() =>
                          setMenuId(
                            menuId === item.id ? null : item.id
                          )
                        }
                      >
                        <Icon name="more" size={15} />
                      </button>

                      {menuId === item.id && renderItemMenu(item)}
                    </div>
                  </div>
                </article>
              ))}

            {!loading && !error && !filteredMedia.length && (
              <div className="empty-state">
                <Icon name="search" size={34} />

                <h3>
                  {media.length ? "No media found" : "No media detected"}
                </h3>

                <p>
                  {media.length
                    ? "Try another search or category."
                    : "Scan this page or play accessible media to discover resources."}
                </p>

                <button
                  className="secondary-button"
                  onClick={() => loadMedia(true)}
                >
                  <Icon name="pulse" />
                  Scan current page
                </button>
              </div>
            )}
          </div>
        </section>

        <aside className="inspector">
          <div className="inspector-tabs">
            {["Preview", "Properties", "Activity"].map((tab) => (
              <button
                key={tab}
                className={activePanel === tab ? "active" : ""}
                onClick={() => setActivePanel(tab)}
              >
                {tab === "Preview" ? (
                  <Icon name="eye" size={16} />
                ) : tab === "Properties" ? (
                  <Icon name="info" size={16} />
                ) : (
                  <Icon name="pulse" size={16} />
                )}
                {tab}
              </button>
            ))}
          </div>

          {!currentItem ? (
            <div className="inspector-empty">
              Select a media item to inspect it.
            </div>
          ) : (
            <>
              {activePanel === "Preview" && (
                <div className="preview-content">
                  <div className="preview-stage">
                    {currentItem.thumbnail ? (
                      <img
                        src={currentItem.thumbnail}
                        alt={currentItem.name}
                      />
                    ) : (
                      <div
                        className={`preview-placeholder ${currentItem.type.toLowerCase()}`}
                      >
                        {currentItem.type}
                      </div>
                    )}

                    <button
                      className="preview-open"
                      onClick={() => openResource(currentItem.url)}
                    >
                      <Icon name="external" />
                    </button>
                  </div>

                  <h3>{currentItem.name}</h3>

                  <p className="preview-description">
                    Detected resource
                  </p>

                  <div className="preview-details">
                    <div>
                      <span>Type</span>
                      <strong>{currentItem.type}</strong>
                    </div>

                    <div>
                      <span>Format</span>
                      <strong>{currentItem.format}</strong>
                    </div>

                    <div>
                      <span>Size</span>
                      <strong>
                        {currentItem.size !== null
                          ? formatSize(currentItem.size)
                          : "Unknown"}
                      </strong>
                    </div>

                    <div>
                      <span>HTTP Status</span>
                      <strong>
                        {currentItem.status ?? "Not available"}
                      </strong>
                    </div>

                    <div>
                      <span>MIME Type</span>
                      <strong>{currentItem.mime || "Unknown"}</strong>
                    </div>

                    <div>
                      <span>Request Type</span>
                      <strong>{currentItem.requestType}</strong>
                    </div>
                  </div>
                </div>
              )}

              {activePanel === "Properties" && (
                <div className="properties-content">
                  <h3>Resource Properties</h3>

                  <div className="property-row">
                    <span>File name</span>
                    <strong>{currentItem.name}</strong>
                  </div>

                  <div className="property-row">
                    <span>Media type</span>
                    <strong>{currentItem.type}</strong>
                  </div>

                  <div className="property-row">
                    <span>Format</span>
                    <strong>{currentItem.format}</strong>
                  </div>

                  <div className="property-row">
                    <span>File size</span>
                    <strong>
                      {currentItem.size !== null
                        ? formatSize(currentItem.size)
                        : "Unknown"}
                    </strong>
                  </div>

                  <div className="property-row">
                    <span>HTTP status</span>
                    <strong>{currentItem.status ?? "Unknown"}</strong>
                  </div>

                  <div className="property-row">
                    <span>Content type</span>
                    <strong>{currentItem.mime || "Unknown"}</strong>
                  </div>

                  <div className="property-row">
                    <span>Request type</span>
                    <strong>{currentItem.requestType}</strong>
                  </div>

                  <div className="property-url">
                    <span>Original source URL</span>
                    <p>{currentItem.url}</p>

                    <button
                      className="secondary-button"
                      onClick={() => copyLink(currentItem.url)}
                    >
                      <Icon name="link" size={15} />
                      Copy URL
                    </button>
                  </div>
                </div>
              )}

              {activePanel === "Activity" && (
                <div className="activity-content">
                  <h3>Discovery Activity</h3>

                  <div className="activity-entry">
                    <span className="activity-dot" />

                    <div>
                      <strong>Resource detected</strong>
                      <small>{currentItem.name}</small>
                    </div>
                  </div>

                  <div className="activity-entry">
                    <span className="activity-dot" />

                    <div>
                      <strong>Discovery source</strong>
                      <small>{currentItem.source}</small>
                    </div>
                  </div>

                  <div className="activity-entry">
                    <span className="activity-dot" />

                    <div>
                      <strong>Request type</strong>
                      <small>{currentItem.requestType}</small>
                    </div>
                  </div>

                  {currentItem.timestamp && (
                    <div className="activity-entry">
                      <span className="activity-dot" />

                      <div>
                        <strong>Timestamp</strong>
                        <small>
                          {new Date(currentItem.timestamp).toLocaleString()}
                        </small>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="inspector-actions">
                <button
                  className="primary-button"
                  onClick={() => downloadItem(currentItem)}
                >
                  <Icon name="download" />
                  Download
                </button>

                <button
                  className="secondary-button"
                  onClick={() => copyLink(currentItem.url)}
                >
                  <Icon name="link" />
                  Copy Link
                </button>

                <button
                  className="icon-button"
                  title="Open resource"
                  onClick={() => openResource(currentItem.url)}
                >
                  <Icon name="external" />
                </button>
              </div>
            </>
          )}
        </aside>
      </main>

      <footer className="bottom-bar">
        <div className="selection-summary">
          <span className="success-indicator">
            <Icon name="check" />
          </span>

          <span>
            {selected.length} of {media.length} items selected
          </span>

          <i />

          <span>
            Selected Size:{" "}
            {formatSize(
              selectedItems.reduce(
                (total, item) => total + (item.size || 0),
                0
              )
            )}
          </span>
        </div>

        <div className="bottom-actions">
          <button
            className="primary-button"
            onClick={downloadSelected}
          >
            <Icon name="download" />
            Download Selected {selected.length > 0 ? `(${selected.length})` : ""}
          </button>
        </div>
      </footer>

      {toast && <div className="toast">{toast}</div>}

      {showCoffeeModal && (
        <div
          className="coffee-modal-backdrop"
          onClick={() => setShowCoffeeModal(false)}
        >
          <div
            className="coffee-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="coffee-modal-header">
              <div className="coffee-modal-title">
                <span className="coffee-modal-icon">☕</span>
                <div>
                  <h3>Buy Me a Coffee</h3>
                  <small>Support ongoing development</small>
                </div>
              </div>
              <button
                className="coffee-close-btn"
                onClick={() => setShowCoffeeModal(false)}
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="coffee-modal-body">
              <p className="coffee-desc">
                If you find MediaHunter useful, consider buying a coffee to support development, companion updates, and maintenance!
              </p>

              <div className="coffee-tiers">
                {[
                  { amount: 3, label: "Single Coffee", sub: "$3", emoji: "☕" },
                  { amount: 5, label: "Coffee & Treat", sub: "$5", emoji: "☕🍩" },
                  { amount: 10, label: "Coffee Break", sub: "$10", emoji: "☕🥐" },
                  { amount: 20, label: "Generous Tip", sub: "$20", emoji: "🌟" },
                ].map((tier) => (
                  <button
                    key={tier.amount}
                    type="button"
                    className={`coffee-tier-btn ${
                      !customAmount && coffeeAmount === tier.amount ? "active" : ""
                    }`}
                    onClick={() => {
                      setCoffeeAmount(tier.amount);
                      setCustomAmount("");
                    }}
                  >
                    <span className="tier-emoji">{tier.emoji}</span>
                    <span className="tier-amount">{tier.sub}</span>
                    <span className="tier-label">{tier.label}</span>
                  </button>
                ))}
              </div>

              <div className="coffee-custom-row">
                <span>Or enter custom amount:</span>
                <div className="coffee-input-wrapper">
                  <span>$</span>
                  <input
                    type="number"
                    min="1"
                    max="999"
                    step="1"
                    placeholder="e.g. 15"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="button"
                className="paypal-donate-btn"
                onClick={handlePaypalDonate}
              >
                <svg className="paypal-svg-icon" viewBox="0 0 24 24" width="20" height="20">
                  <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 3.72a.78.78 0 0 1 .77-.65h7.625c3.784 0 6.643 1.54 6.223 5.485-.297 2.784-1.996 4.417-4.49 4.417h-2.14a.78.78 0 0 0-.77.65l-.946 5.98a.64.64 0 0 1-.633.535H7.076z" fill="#003087"/>
                  <path d="M18.868 6.555c-.297 2.784-1.996 4.417-4.49 4.417h-2.14a.78.78 0 0 0-.77.65l-1.393 8.815a.55.55 0 0 1-.543.463H6.84a.43.43 0 0 1-.424-.497l1.79-11.34a.78.78 0 0 1 .77-.65h5.535c3.084 0 4.79.88 4.357 3.142z" fill="#0079C1"/>
                </svg>
                <span>
                  Tip ${(customAmount ? (parseFloat(customAmount) || 0) : coffeeAmount)} via PayPal
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
