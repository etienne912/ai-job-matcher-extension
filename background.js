import { callProvider, fetchOllamaModels } from './lib/providers.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// Use a persistent port for AI requests so the service worker stays alive
// for the full duration of slow providers (e.g. Ollama).
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ai-request') return;

  let isDisconnected = false;

  const onMessage = (payload) => {
    if (isDisconnected) return;

    if (payload.type === 'PING') {
      return; // Keep-alive
    }

    callProvider(payload)
      .then(text => {
        if (!isDisconnected) port.postMessage({ text });
      })
      .catch(err => {
        if (!isDisconnected) port.postMessage({ error: err.message });
      })
      .finally(() => {
        if (!isDisconnected) port.disconnect();
      });
  };

  port.onMessage.addListener(onMessage);

  port.onDisconnect.addListener(() => {
    isDisconnected = true;
  });
});

/**
 * Robust message listener wrapper to ensure sendResponse is always called
 * and async operations are handled correctly.
 */
function addAsyncMessageListener(handler) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handler(message, sender)
      .then(response => {
        try {
          sendResponse(response);
        } catch (err) {
          console.warn('sendResponse failed (likely port closed):', err);
        }
      })
      .catch(err => {
        console.error('Message handler error:', err);
        try {
          sendResponse({ error: err.message });
        } catch (e) {
          // ignore
        }
      });
    return true; // Keep message channel open
  });
}

addAsyncMessageListener(async (message, sender) => {
  if (message.type === 'JOB_DETECTED') {
    const tabId = sender.tab.id;
    await chrome.storage.session.set({
      [`jobText_${tabId}`]: message.text,
      [`jobUrl_${tabId}`]: message.url
    });
    // Clear any stale analysis when a new job is detected
    await chrome.storage.session.remove([`analysis_${tabId}`]);
    // Attempt to open the panel
    try {
      await chrome.sidePanel.open({ tabId });
    } catch (e) {
      // ignore
    }
    return { success: true };
  }

  if (message.type === 'GET_JOB_TEXT') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return { text: null, url: null };
    const tabId = tabs[0].id;

    const stored = await chrome.storage.session.get([`jobText_${tabId}`, `jobUrl_${tabId}`]);
    if (stored[`jobText_${tabId}`]) {
      return { text: stored[`jobText_${tabId}`], url: stored[`jobUrl_${tabId}`] };
    }

    // Fall back to querying the content script directly
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_TEXT' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ text: null, url: null });
        } else {
          resolve({ text: response.text, url: response.url });
        }
      });
    });
  }

  if (message.type === 'GET_ANALYSIS') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]) return { analysis: null };
    const tabId = tabs[0].id;
    
    // 1. Check session storage (current tab's analysis)
    const result = await chrome.storage.session.get([`analysis_${tabId}`]);
    if (result[`analysis_${tabId}`]) {
      return { analysis: result[`analysis_${tabId}`] };
    }

    // 2. Check history for this URL
    const stored = await chrome.storage.session.get([`jobUrl_${tabId}`]);
    const url = stored[`jobUrl_${tabId}`];
    if (url) {
      const { history = [] } = await chrome.storage.local.get('history');
      const cached = history.find(h => h.url === url);
      if (cached) {
        // Found in history, save it to session so it persists for this tab session
        await chrome.storage.session.set({ [`analysis_${tabId}`]: cached });
        return { analysis: cached };
      }
    }
    
    return { analysis: null };
  }

  if (message.type === 'SAVE_ANALYSIS') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      const tabId = tabs[0].id;
      const stored = await chrome.storage.session.get([`jobUrl_${tabId}`]);
      const url = stored[`jobUrl_${tabId}`];
      
      await chrome.storage.session.set({ [`analysis_${tabId}`]: message.analysis });
      
      // Also save to history if not partial
      if (!message.analysis.isPartial) {
        const { history = [] } = await chrome.storage.local.get('history');
        const entry = { ...message.analysis, url, timestamp: Date.now() };
        const filtered = history.filter(h => 
          !(h.jobTitle === entry.jobTitle && h.company === entry.company)
        );
        const newHistory = [entry, ...filtered].slice(0, 30);
        await chrome.storage.local.set({ history: newHistory });
      }
    }
    return { success: true };
  }

  if (message.type === 'CLEAR_ANALYSIS') {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) {
      const id = tabs[0].id;
      await chrome.storage.session.remove([`analysis_${id}`, `jobText_${id}`, `jobUrl_${id}`]);
    }
    return { success: true };
  }

  if (message.type === 'FETCH_OLLAMA_MODELS') {
    try {
      const models = await fetchOllamaModels();
      return { models };
    } catch (err) {
      return { error: err.message };
    }
  }

  if (message.type === 'REFRESH_SIDEBAR') {
    // This is just a trigger for sidebar to re-init
    return { success: true };
  }

  return null; // Unhandled message
});

// Notify sidebar when active tab changes
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    await chrome.runtime.sendMessage({ type: 'TAB_CHANGED', tabId: activeInfo.tabId });
  } catch (e) {
    // Sidebar might not be open, ignore
  }
});

// Notify sidebar when tab URL changes (e.g. user types new URL in active tab)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.url && tab.active) {
    try {
      await chrome.runtime.sendMessage({ type: 'TAB_CHANGED', tabId });
    } catch (e) {
      // Sidebar might not be open, ignore
    }
  }
});
