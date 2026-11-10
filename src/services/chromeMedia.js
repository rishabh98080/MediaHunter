
export async function getActiveTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (!tab?.id) {
    throw new Error("No active tab found.");
  }

  return tab;
}

export async function scanCurrentTab() {
  const tab = await getActiveTab();

  return chrome.runtime.sendMessage({
    type: "SCAN_TAB",
    tabId: tab.id
  });
}

export async function getCurrentMedia() {
  const tab = await getActiveTab();

  return chrome.runtime.sendMessage({
    type: "GET_MEDIA",
    tabId: tab.id
  });
}

export async function downloadMedia(url, filename) {
  if (!url) {
    throw new Error("Media URL is missing.");
  }

  const tab = await getActiveTab().catch(() => null);

  return chrome.runtime.sendMessage({
    type: "DOWNLOAD_MEDIA",
    url,
    filename,
    tabId: tab?.id
  });
}

export async function clearCurrentMedia() {
  const tab = await getActiveTab();

  return chrome.runtime.sendMessage({
    type: "CLEAR_MEDIA",
    tabId: tab.id
  });
}
