(function () {
  'use strict';

  const JOB_KEYWORDS = [
    'responsibilities', 'requirements', 'qualifications', 'apply',
    'salary', 'benefits', 'experience', 'skills', 'compensation', 'hiring'
  ];
  const MIN_KEYWORD_MATCHES = 3;
  const MAX_WORDS = 2000;

  let lastSentUrl = null;
  let debounceTimer = null;

  function extractText() {
    const priorityEl = document.querySelector(
      'main, article, [role="main"], .job-description, #job-description, ' +
      '.jobDescriptionContent, .description__text, [data-testid="job-detail"]'
    );
    const source = priorityEl || document.body;
    const clone = source.cloneNode(true);

    clone.querySelectorAll(
      'nav, footer, header, [role="navigation"], [role="banner"], ' +
      'script, style, noscript, .cookie-banner, #cookie-banner, ' +
      '.nav, .navbar, .footer, .header, [aria-hidden="true"]'
    ).forEach(el => el.remove());

    return (clone.innerText || clone.textContent || '').trim();
  }

  function isJobListing(text) {
    const lower = text.toLowerCase();
    const matches = JOB_KEYWORDS.filter(kw => lower.includes(kw));
    return matches.length >= MIN_KEYWORD_MATCHES;
  }

  function truncateWords(text, maxWords) {
    const words = text.split(/\s+/);
    return words.length <= maxWords ? text : words.slice(0, maxWords).join(' ') + '…';
  }

  function tryDetect() {
    if (lastSentUrl === window.location.href) return;

    const text = extractText();
    if (!isJobListing(text)) return;

    const truncated = truncateWords(text, MAX_WORDS);
    lastSentUrl = window.location.href;

    chrome.runtime.sendMessage({
      type: 'JOB_DETECTED',
      text: truncated,
      url: window.location.href
    }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_PAGE_TEXT') {
      const text = extractText();
      sendResponse({ text: truncateWords(text, MAX_WORDS), url: window.location.href });
    }
    if (message.type === 'IS_JOB_PAGE') {
      sendResponse({ isJob: isJobListing(extractText()) });
    }
    return false;
  });

  // Detect SPA navigation by patching history methods
  function onUrlChange() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      lastSentUrl = null;
      tryDetect();
    }, 1500);
  }

  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = function (...args) {
    origPush(...args);
    onUrlChange();
  };
  history.replaceState = function (...args) {
    origReplace(...args);
    onUrlChange();
  };

  window.addEventListener('popstate', onUrlChange);

  tryDetect();
})();
