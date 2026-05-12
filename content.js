(function () {
  'use strict';

  const JOB_KEYWORDS = [
    'responsibilities', 'requirements', 'qualifications', 'apply',
    'salary', 'benefits', 'experience', 'skills', 'compensation', 'hiring',
    'description', 'about the role', 'ideal candidate', 'what you will do',
    'key responsibilities', 'minimum qualifications', 'preferred qualifications',
    'who we are', 'equal opportunity employer', 'years of experience'
  ];
  const MAX_WORDS = 2000;

  let lastSentUrl = null;
  let debounceTimer = null;

  function extractText() {
    // 1. Identify the core container
    const selectors = [
      'main', 'article', '[role="main"]',
      '.job-description', '#job-description', '.jobDescriptionContent',
      '.description__text', '[data-testid="job-detail"]', '.job-details-content',
      '#jobDescriptionText', '.jobs-description', '.jobs-description-content',
      '.job-details-post', '#vjs-content', '.show-more-less-html__markup'
    ];
    
    let source = null;
    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && el.innerText && el.innerText.length > 200) {
        source = el;
        break;
      }
    }
    
    if (!source) source = document.body;

    const clone = source.cloneNode(true);

    // 2. Remove noise
    const noiseSelectors = [
      'nav', 'footer', 'header', 'aside', '[role="navigation"]', '[role="banner"]',
      'script', 'style', 'noscript', 'canvas', 'svg', 'iframe',
      '.cookie-banner', '#cookie-banner', '.nav', '.navbar', '.footer', '.header',
      '[aria-hidden="true"]', 'button', '.apply-button', '.social-share',
      '.similar-jobs', '.recommended-jobs', '#recent-searches', '.sidebar',
      '.job-alert-form', '.jobs-upsell', '.jobs-search-box'
    ];

    clone.querySelectorAll(noiseSelectors.join(', ')).forEach(el => el.remove());

    // 2.5 Remove display:none elements
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_ELEMENT, null, false);
    const hiddenNodes = [];
    let node = walker.nextNode();
    while (node) {
      if (node.style && (node.style.display === 'none' || node.style.visibility === 'hidden')) {
        hiddenNodes.push(node);
      }
      node = walker.nextNode();
    }
    hiddenNodes.forEach(n => n.remove());

    // 3. Clean up text
    let text = clone.innerText || clone.textContent || '';
    
    // Normalize whitespace: replace multiple spaces/newlines with single ones
    text = text.replace(/\s+/g, ' ').trim();

    return text;
  }

  function isJobListing(text) {
    if (!text || text.length < 300) return false;
    const lower = text.toLowerCase();
    
    // Weighted scoring
    let score = 0;
    JOB_KEYWORDS.forEach(kw => {
      // Use regex for whole-word matching or just include check for simple phrases
      if (lower.includes(kw)) {
        // High-value keywords get more weight
        if (['responsibilities', 'qualifications', 'requirements', 'salary', 'experience', 'about the role', 'ideal candidate'].includes(kw)) {
          score += 2;
        } else {
          score += 1;
        }
      }
    });

    return score >= 6; // Slightly lower threshold but with weighted scores
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
