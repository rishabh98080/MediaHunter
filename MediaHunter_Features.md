# MediaHunter --- Feature Specification

> **Product:** MediaHunter\
> **Type:** Chrome Extension (Manifest V3)\
> **Purpose:** Discover, inspect, organize, and download media resources
> exposed by the webpages a user visits.

------------------------------------------------------------------------

## 1. Overview

MediaHunter is a browser extension that helps users find media resources
on supported webpages and inspect the resources in one place. It
combines page scanning with network-resource detection, then presents
the discovered items in a compact popup interface.

The extension is intended to work locally in the browser. The initial
implementation does not require a backend service.

### Supported platforms

MediaHunter is designed to detect media on webpages from:

-   YouTube
-   Instagram
-   X (Twitter)
-   Facebook
-   TikTok
-   Reddit
-   Other websites that expose media resources through page elements or
    network requests

Platform support depends on what the page makes available to the
browser. A platform being listed does **not** guarantee that every item
on it can be downloaded.

------------------------------------------------------------------------

## 2. Core Features

### 2.1 Media discovery

-   Detect media resources loaded by the active browser tab.
-   Scan media elements already present in the page.
-   Observe completed network requests for media-like responses.
-   Collect resource URLs and available metadata.
-   Combine page-scan results and network-detection results.
-   Avoid adding the same resource repeatedly.
-   Refresh the media list when new resources are detected.
-   Handle pages where some resources are discovered only after
    scrolling or interacting with the page.

### 2.2 Supported media types

MediaHunter is intended to identify and categorize:

  -----------------------------------------------------------------------
  Category                            Examples
  ----------------------------------- -----------------------------------
  Images                              JPG, JPEG, PNG, GIF, WebP, SVG,
                                      AVIF

  Videos                              MP4, WebM, MOV and other
                                      recognizable video resources

  Audio                               MP3, WAV, OGG, M4A and other
                                      recognizable audio resources

  Documents                           PDF and other explicitly supported
                                      document resources

  Streaming resources                 HLS (`.m3u8`) and DASH (`.mpd`)
                                      manifests, where detectable
  -----------------------------------------------------------------------

The detected file type should be based on available MIME information,
URL extensions, or the type of page element that exposed the resource.

### 2.3 Media library

-   Display discovered media in a single list.
-   Show a thumbnail or a media-type placeholder.
-   Display the resource name or a useful fallback filename.
-   Display media category and available format information.
-   Display file size only when it is actually available.
-   Display the source URL or a shortened version of it.
-   Show the currently selected item in a details/inspector panel.
-   Provide an empty state when no media has been found.
-   Provide a loading state while scanning or retrieving results.
-   Provide an error state when a browser operation fails.

### 2.4 Filtering and search

-   Filter media by category:
    -   All
    -   Images
    -   Videos
    -   Audio
    -   Documents
    -   Streams
-   Search discovered items by filename, URL, or available metadata.
-   Keep filtering local to the discovered media list.
-   Make it clear when the current filter or search has no matches.

### 2.5 Sorting and display

-   Sort discovered media using available metadata.
-   Support list and grid-style viewing where available in the
    interface.
-   Keep the selected item identifiable while changing the view or sort
    order.
-   Do not invent file sizes, formats, dates, or other metadata when the
    browser does not provide them.

### 2.6 Media inspection

For a selected resource, show the metadata that is available:

-   Filename
-   Media category
-   Format or MIME type
-   File size, when known
-   Resource URL
-   Source page/tab context, where available

The inspector may provide a preview for formats that the browser can
display. If preview is unavailable, show the resource information
instead.

### 2.7 Downloading

-   Download an individual resource using the Chrome Downloads API.
-   Allow the browser to manage the download destination and download
    state.
-   Use a meaningful filename when one can be determined.
-   Report download errors rather than showing a false success state.
-   Do not present streaming manifests or segments as ordinary
    downloadable media when they cannot be downloaded as a single usable
    file.
-   Do not fabricate download links or file sizes.

**Important:** A resource being detected does not mean it is
downloadable. Downloads can fail because a URL is temporary, requires an
authenticated session, is blocked by server policy, or is otherwise
inaccessible to the browser's download mechanism.

### 2.8 Bulk selection and actions

-   Select an individual media item.
-   Select multiple items where supported by the interface.
-   Show a selection count.
-   Provide bulk actions only for actions that are actually implemented
    and valid for the selected resources.
-   Clear the selection when appropriate.
-   Avoid reporting a bulk download as successful until Chrome confirms
    the individual download requests.

### 2.9 Resource actions

Depending on the resource and the browser's capabilities:

-   Download the resource.
-   Copy the resource URL.
-   Open the resource URL in a browser tab.
-   Remove an item from the current visible list.
-   Inspect resource details.

Removing an item from the popup should not be described as deleting the
original media from the website.

### 2.10 Live detection and rescanning

-   Support scanning the active tab on demand.
-   Support refreshing the discovered media list.
-   Listen for media updates from the extension service worker.
-   Update the popup when new resources are reported.
-   Keep page scanning and network monitoring separate so each can be
    maintained independently.

------------------------------------------------------------------------

## 3. User Interface

MediaHunter uses the existing dark navy and blue visual direction. The
interface should remain compact and readable inside a Chrome extension
popup.

### Main interface areas

1.  **Header**
    -   MediaHunter branding.
    -   Extension identity.
2.  **Category navigation**
    -   Quick filters for media categories.
    -   An all-media view.
3.  **Action toolbar**
    -   Scan/refresh action.
    -   Selection-related actions.
    -   Search and sorting controls.
4.  **Media workspace**
    -   Discovered media list or grid.
    -   Thumbnails or type placeholders.
    -   Filename, type, and available metadata.
    -   Per-item actions.
5.  **Inspector panel**
    -   Selected media preview, when supported.
    -   Resource properties.
    -   Resource actions.
6.  **Status area**
    -   Loading and error feedback.
    -   Selection summary.
    -   Short-lived action notifications.

### Interface states

-   Initial/loading state
-   No media detected
-   Media results available
-   Search/filter with no matches
-   Item selected
-   Multiple items selected
-   Scan failed
-   Download started or failed
-   Unsupported page or unavailable browser API

------------------------------------------------------------------------

## 4. Technical Architecture

### Browser platform

-   Chrome Extension Manifest V3
-   JavaScript
-   React
-   Vite
-   Chrome extension APIs

### Main components

  -----------------------------------------------------------------------
  Component                           Responsibility
  ----------------------------------- -----------------------------------
  `manifest.json`                     Declares extension metadata,
                                      permissions, popup, and service
                                      worker

  `index.html`                        Popup HTML entry point

  `App.jsx`                           Popup interface and UI state

  `App.css`                           Existing popup styling

  `service-worker.js`                 Background network observation,
                                      message handling, storage, and
                                      downloads

  Vite build                          Produces the packaged extension
                                      files in `dist/`
  -----------------------------------------------------------------------

### Chrome APIs

The implementation may use the following APIs where needed:

-   `chrome.tabs` --- identify and query the active tab.
-   `chrome.scripting` --- run the page scanner in the active tab.
-   `chrome.webRequest` --- observe eligible completed network requests.
-   `chrome.storage.session` --- keep per-session, per-tab discovery
    results.
-   `chrome.runtime` --- popup/service-worker messaging and update
    events.
-   `chrome.downloads` --- initiate browser-managed downloads.

Permissions should be kept to the minimum required by the implemented
functionality.

### Data flow

1.  The popup requests a scan or asks for the current media list.
2.  The service worker identifies the active tab.
3.  The page scanner inspects accessible media elements and links.
4.  The network observer contributes media-like request information.
5.  The service worker normalizes and deduplicates discovered resources.
6.  Results are stored for the current browser session.
7.  The popup receives the results and renders the media library.
8.  A user action, such as downloading, is sent to the service worker.
9.  The service worker invokes the relevant Chrome API and returns the
    result.

------------------------------------------------------------------------

## 5. Suggested Message Contract

The popup and service worker should use a consistent message contract.

  Message            Purpose
  ------------------ --------------------------------------------------
  `SCAN_TAB`         Scan the active tab for discoverable media
  `GET_MEDIA`        Retrieve media already discovered for a tab
  `MEDIA_UPDATED`    Notify the popup that the media list has changed
  `DOWNLOAD_MEDIA`   Request a browser-managed download
  `CLEAR_MEDIA`      Clear stored discovery results for a tab

Messages should have predictable request and response shapes. Errors
should be returned explicitly so the popup can display useful feedback.

------------------------------------------------------------------------

## 6. Privacy and Security

-   The initial product is designed to run without a MediaHunter
    backend.
-   Discovered resource information should remain in browser-managed
    extension storage.
-   Do not transmit browsing history or discovered URLs to an external
    server.
-   Do not collect passwords, cookies, or authentication tokens.
-   Do not expose sensitive page content in logs.
-   Treat URLs and metadata received from webpages as untrusted input.
-   Use only the permissions needed for the extension's functionality.
-   Handle restricted browser pages gracefully; Chrome does not allow
    extensions to inject scripts into every page.

------------------------------------------------------------------------

## 7. Platform and Download Limitations

MediaHunter is a discovery and inspection tool, not a guarantee that
every detected resource can be saved.

The extension must not:

-   Bypass DRM or encryption.
-   Bypass login requirements or private-account restrictions.
-   Circumvent paywalls or platform access controls.
-   Extract protected streams or defeat technical restrictions.
-   Claim that a detected resource is downloadable when it has not been
    verified.

Some platforms deliver media through segmented or encrypted streaming
systems, temporary URLs, authenticated requests, or application-specific
playback pipelines. In those cases, MediaHunter may identify a manifest
or resource without being able to provide a usable standalone download.

Users are responsible for complying with platform terms, copyright law,
and applicable permissions when saving or reusing media.

------------------------------------------------------------------------

## 8. Reliability and Error Handling

-   Handle missing Chrome APIs when the app is opened outside the
    extension context.
-   Handle tabs that close during a scan.
-   Handle pages where script injection is restricted.
-   Handle invalid, expired, or inaccessible resource URLs.
-   Handle missing MIME types and filenames.
-   Deduplicate repeated network and DOM discoveries.
-   Avoid treating unknown content as a confirmed media type.
-   Keep the popup usable when one resource fails.
-   Show meaningful errors instead of silently failing.
-   Clear per-tab session data when it is no longer needed.

------------------------------------------------------------------------

## 9. Build and Test Workflow

### Build

``` bash
npm install
npm run build
```

The production build should generate the extension in `dist/`. The
manifest and service worker must be included in the generated directory.

### Load into Chrome

1.  Open `chrome://extensions`.
2.  Enable **Developer mode**.
3.  Select **Load unpacked**.
4.  Choose the project's `dist/` directory.
5.  Pin MediaHunter to the toolbar.
6.  Open a test webpage and launch the extension.

### Debugging

-   Inspect the popup to diagnose React/UI errors.
-   Inspect the extension service worker to diagnose background errors.
-   Check the extension's Errors section for manifest and permission
    problems.
-   Rebuild and reload the extension after changing source files.

### Test cases

-   A page containing ordinary image elements.
-   A page containing video and audio elements.
-   A page with media URLs exposed through links.
-   A page that loads media after scrolling or interaction.
-   A page with repeated references to the same resource.
-   A page with missing MIME or filename information.
-   A restricted browser page where script injection is unavailable.
-   A resource with an expired or inaccessible URL.
-   A stream manifest that should be identified but not falsely offered
    as a normal file download.
-   A page with no discoverable media.

------------------------------------------------------------------------

## 10. Development Priorities

### Phase 1 --- Basic working extension

-   Load the popup as a Chrome extension.
-   Scan the active tab.
-   Detect common image, video, and audio resources.
-   Display real discovered resources.
-   Show available metadata without fabricated values.
-   Download eligible direct media URLs.
-   Copy and open resource URLs.
-   Handle errors and empty states.

### Phase 2 --- Better discovery and organization

-   Improve network and DOM result merging.
-   Improve duplicate detection.
-   Add robust filtering, search, and sorting.
-   Improve selected-item inspection and previews.
-   Support multi-selection and verified bulk actions.
-   Improve dynamic-page rescanning.

### Phase 3 --- Platform-specific improvements

-   Test detection behavior on YouTube, Instagram, X, Facebook, TikTok,
    and Reddit.
-   Document platform-specific limitations.
-   Improve identification of manifests and segmented streams without
    bypassing protections.
-   Add platform-specific handling only where it is permitted and
    technically reliable.

------------------------------------------------------------------------

## 11. Definition of Done

A feature is considered complete only when:

-   It uses real page data or real Chrome API results.
-   It works in the unpacked Chrome extension, not only in the Vite
    development server.
-   Its success and failure states are handled.
-   It does not use placeholder media, fake sizes, or simulated download
    results.
-   It does not claim unsupported platform or download capabilities.
-   It preserves the existing MediaHunter UI and visual design unless a
    UI change is explicitly requested.

------------------------------------------------------------------------

## 12. Current Scope vs. Future Work

This document describes the intended MediaHunter feature set. It is a
product specification, not a claim that every feature is already
implemented.

The first milestone should focus on reliable discovery of ordinary media
resources, accurate metadata, and browser-managed downloads. Advanced
platform-specific extraction, streaming reconstruction, and other
restricted media workflows are not part of the initial scope.
