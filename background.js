import { callProvider, fetchOllamaModels } from './lib/providers.js';
import { createJobSignature, findCachedAnalysis, isMatchingAnalysis } from './lib/job-cache.js';

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
    const tabId = sender.tab?.id;
    if (!tabId) return { success: false, error: 'No tab context available' };
    const jobSignature = createJobSignature(message.text);
    await chrome.storage.session.set({
      [`jobText_${tabId}`]: message.text,
      [`jobUrl_${tabId}`]: message.url,
      [`jobSignature_${tabId}`]: jobSignature
    });
    // Clear any stale analysis when a new job is detected
    await chrome.storage.session.remove([`analysis_${tabId}`]);

    const { autoAnalysisMode = 'auto' } = await chrome.storage.local.get('autoAnalysisMode');

    // If the side panel is already open, tell it to analyse the new listing.
    try {
      await chrome.runtime.sendMessage({
        type: 'SIDEBAR_JOB_DETECTED',
        tabId,
        text: message.text,
        url: message.url,
        jobSignature,
        autoAnalysisMode
      });
    } catch (e) {
      // Sidebar might not be open, ignore
    }

    // Attempt to open the panel
    if (autoAnalysisMode !== 'manual') {
      try {
        await chrome.sidePanel.open({ tabId });
      } catch (e) {
        // ignore
      }
    }
    return { success: true };
  }

  if (message.type === 'GET_JOB_TEXT') {
    const tabId = message.tabId || (await getActiveTabId());
    if (!tabId) return { text: null, url: null, tabId: null };

    const stored = await chrome.storage.session.get([
      `jobText_${tabId}`,
      `jobUrl_${tabId}`,
      `jobSignature_${tabId}`
    ]);
    if (stored[`jobText_${tabId}`]) {
      const jobSignature = stored[`jobSignature_${tabId}`] || createJobSignature(stored[`jobText_${tabId}`]);
      if (!stored[`jobSignature_${tabId}`]) {
        await chrome.storage.session.set({ [`jobSignature_${tabId}`]: jobSignature });
      }
      return { text: stored[`jobText_${tabId}`], url: stored[`jobUrl_${tabId}`], jobSignature, tabId };
    }

    // Fall back to querying the content script directly
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_PAGE_TEXT' }, async (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ text: null, url: null, tabId });
        } else {
          const jobSignature = createJobSignature(response.text);
          await chrome.storage.session.set({
            [`jobText_${tabId}`]: response.text,
            [`jobUrl_${tabId}`]: response.url,
            [`jobSignature_${tabId}`]: jobSignature
          });
          resolve({ text: response.text, url: response.url, jobSignature, tabId });
        }
      });
    });
  }

  if (message.type === 'GET_ANALYSIS') {
    const tabId = message.tabId || (await getActiveTabId());
    if (!tabId) return { analysis: null };
    
    const stored = await chrome.storage.session.get([
      `analysis_${tabId}`,
      `jobText_${tabId}`,
      `jobSignature_${tabId}`
    ]);
    const jobSignature = message.jobSignature
      || stored[`jobSignature_${tabId}`]
      || createJobSignature(stored[`jobText_${tabId}`]);

    // 1. Check session storage for this exact job listing.
    if (isMatchingAnalysis(stored[`analysis_${tabId}`], jobSignature)) {
      return { analysis: stored[`analysis_${tabId}`] };
    }

    // 2. Check history for this exact job listing.
    if (jobSignature) {
      const { history = [] } = await chrome.storage.local.get('history');
      const cached = findCachedAnalysis(history, jobSignature);
      if (cached) {
        await chrome.storage.session.set({ [`analysis_${tabId}`]: cached });
        return { analysis: cached };
      }
    }
    
    return { analysis: null };
  }

  if (message.type === 'SAVE_ANALYSIS') {
    const tabId = message.tabId || (await getActiveTabId());
    if (tabId) {
      const stored = await chrome.storage.session.get([`jobUrl_${tabId}`, `jobText_${tabId}`, `jobSignature_${tabId}`]);
      const url = message.url || stored[`jobUrl_${tabId}`];
      const jobSignature = message.jobSignature
        || stored[`jobSignature_${tabId}`]
        || createJobSignature(stored[`jobText_${tabId}`]);
      const analysis = { ...message.analysis, jobSignature };

      await chrome.storage.session.set({ [`analysis_${tabId}`]: analysis });
      
      // Also save to history if not partial
      if (!analysis.isPartial) {
        const { history = [] } = await chrome.storage.local.get('history');
        const entry = { ...analysis, url, timestamp: Date.now() };
        const filtered = history.filter(item => item.jobSignature !== jobSignature);
        const newHistory = [entry, ...filtered].slice(0, 30);
        await chrome.storage.local.set({ history: newHistory });
      }
    }
    return { success: true };
  }

  if (message.type === 'CLEAR_ANALYSIS') {
    const id = message.tabId || (await getActiveTabId());
    if (id) {
      await chrome.storage.session.remove([`analysis_${id}`, `jobText_${id}`, `jobUrl_${id}`, `jobSignature_${id}`]);
    }
    return { success: true };
  }

  if (message.type === 'CLEAR_HISTORY') {
    await chrome.storage.local.set({ history: [] });
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

async function getActiveTabId() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id || null;
}

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
  if (!changeInfo.url) return;

  const stored = await chrome.storage.session.get([`jobUrl_${tabId}`]);
  if (stored[`jobUrl_${tabId}`] && stored[`jobUrl_${tabId}`] !== changeInfo.url) {
    await chrome.storage.session.remove([
      `analysis_${tabId}`,
      `jobText_${tabId}`,
      `jobUrl_${tabId}`,
      `jobSignature_${tabId}`
    ]);
  }

  if (!tab.active) return;

  try {
    await chrome.runtime.sendMessage({ type: 'TAB_CHANGED', tabId });
  } catch (e) {
    // Sidebar might not be open, ignore
  }
});
