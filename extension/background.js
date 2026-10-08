// Toolbar button: inject the overlay into the current tab (activeTab grant),
// unless the tab is on a site where people play live games.
importScripts('guard.js');

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https?:/.test(tab.url || '')) return;
  if (self.ChessGuard.isBlockedUrl(tab.url)) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: showBlockedNotice }).catch(() => {});
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['guard.js', 'snap.js', 'content.js'] });
  } catch (e) {
    console.warn('Simple Chess Video Analyzer Extension: cannot run on this page', e);
  }
});

function showBlockedNotice() {
  const d = document.createElement('div');
  d.textContent = 'Simple Chess Video Analyzer Extension is turned off on chess playing sites, so it can’t be used to get help during games.';
  d.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#16181d;color:#fff;padding:10px 16px;border-radius:8px;font:13px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.4)';
  document.documentElement.appendChild(d);
  setTimeout(() => d.remove(), 4500);
}

// Stop the overlay if a tab running it navigates onto a blocked site.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.url && self.ChessGuard.isBlockedUrl(info.url)) {
    chrome.scripting.executeScript({ target: { tabId }, func: () => window.__liveChessAnalysis && window.__liveChessAnalysis.shutdown() }).catch(() => {});
  }
});
