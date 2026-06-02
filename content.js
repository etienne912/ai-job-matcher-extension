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
  const DETECTION_DEBOUNCE_MS = 1200;
  const JOB_DETAIL_SELECTORS = [
    '[class*="ashby-job-posting"]',
    '.ashby-job-posting-right-pane',
    '.ashby-job-posting-left-pane',
    '#overview[role="tabpanel"]',
    '.jobs-search__job-details--container',
    '.jobs-details__main-content',
    '.jobs-details',
    '.job-view-layout',
    '.jobs-description',
    '.jobs-description__container',
    '.jobs-description-content__text',
    '.jobs-box__html-content',
    '.jobs-unified-top-card',
    '.job-description',
    '#job-description',
    '.jobDescriptionContent',
    '.description__text',
    '[data-testid="job-detail"]',
    '.job-details-content',
    '#jobDescriptionText',
    '.jobs-description-content',
    '.job-details-post',
    '#vjs-content',
    '.show-more-less-html__markup'
  ];
  const JOB_DETAIL_SELECTOR = JOB_DETAIL_SELECTORS.join(', ');

  let lastSentSignature = null;
  let debounceTimer = null;

  function getStructuredJobPostingText() {
    const parts = [];

    document.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        return;
      }

      const entries = Array.isArray(data) ? data : [data];
      entries.flatMap(item => item?.['@graph'] || item).forEach(item => {
        const type = item?.['@type'];
        const isJobPosting = Array.isArray(type) ? type.includes('JobPosting') : type === 'JobPosting';
        if (!item || !isJobPosting) return;

        const org = item.hiringOrganization;
        const location = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation;
        const address = location?.address;
        const salary = item.baseSalary?.value;

        parts.push([
          item.title && `Title: ${item.title}`,
          org?.name && `Company: ${org.name}`,
          address && `Location: ${[address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ')}`,
          item.employmentType && `Employment type: ${Array.isArray(item.employmentType) ? item.employmentType.join(', ') : item.employmentType}`,
          salary?.minValue && `Salary minimum: ${salary.minValue} ${salary.currency || item.baseSalary?.currency || ''}`,
          salary?.maxValue && `Salary maximum: ${salary.maxValue} ${salary.currency || item.baseSalary?.currency || ''}`,
          item.description && `Description: ${stripHtml(item.description)}`
        ].filter(Boolean).join('\n'));
      });
    });

    return parts.join('\n\n');
  }

  function stripHtml(html) {
    const el = document.createElement('div');
    el.innerHTML = html;
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function hasStructuredJobPosting() {
    return getStructuredJobPostingText().length > 0;
  }

  function hasJobDetailContainer() {
    return JOB_DETAIL_SELECTORS.some(selector => {
      const el = document.querySelector(selector);
      return el?.innerText && el.innerText.length > 200;
    });
  }

  function hasJobUrlSignal() {
    return /(^|[/.?&=-])(jobs?|careers?|positions?|vacancies|recruitment|jobsearch|job-detail|job-view|ashbyhq)([/.?&=-]|$)/i
      .test(window.location.href);
  }

  function getJobKeywordScore(text) {
    const lower = text.toLowerCase();
    let score = 0;

    JOB_KEYWORDS.forEach(kw => {
      if (lower.includes(kw)) {
        if (['responsibilities', 'qualifications', 'requirements', 'salary', 'experience', 'about the role', 'ideal candidate'].includes(kw)) {
          score += 2;
        } else {
          score += 1;
        }
      }
    });

    return score;
  }

  function extractText() {
    const structuredText = getStructuredJobPostingText();

    // 1. Identify the core container
    const selectors = [
      ...JOB_DETAIL_SELECTORS,
      'main', 'article', '[role="main"]'
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

    return [structuredText, text].filter(Boolean).join('\n\n');
  }

  function isJobListing(text) {
    if (!text || text.length < 300) return false;
    return getJobKeywordScore(text) >= 6;
  }

  function shouldAutoDetect(text) {
    if (!text || text.length < 300) return false;
    if (hasStructuredJobPosting()) return true;

    const keywordScore = getJobKeywordScore(text);
    if (hasJobDetailContainer()) return keywordScore >= 5;
    if (hasJobUrlSignal()) return keywordScore >= 8;

    return false;
  }

  function truncateWords(text, maxWords) {
    const words = text.split(/\s+/);
    return words.length <= maxWords ? text : words.slice(0, maxWords).join(' ') + '…';
  }

  function getSignature(text) {
    const normalized = text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\b\d+\s+applicants?\b/g, '')
      .replace(/\bposted\s+\d+\s+\w+\s+ago\b/g, '')
      .trim();

    let hash = 0;
    for (let i = 0; i < normalized.length; i += 1) {
      hash = ((hash << 5) - hash + normalized.charCodeAt(i)) | 0;
    }

    return `${normalized.length}:${hash}`;
  }

  function tryDetect() {
    const text = extractText();
    if (!shouldAutoDetect(text)) return;

    const truncated = truncateWords(text, MAX_WORDS);
    const signature = getSignature(truncated);
    if (signature === lastSentSignature) return;

    lastSentSignature = signature;

    chrome.runtime.sendMessage({
      type: 'JOB_DETECTED',
      text: truncated,
      url: window.location.href
    }).catch(() => {});
  }

  function scheduleDetect(delay = DETECTION_DEBOUNCE_MS) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(tryDetect, delay);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_PAGE_TEXT') {
      const text = extractText();
      sendResponse({ text: truncateWords(text, MAX_WORDS), url: window.location.href });
    }
    if (message.type === 'IS_JOB_PAGE') {
      sendResponse({ isJob: shouldAutoDetect(extractText()) });
    }
    return false;
  });

  // Detect SPA navigation by patching history methods
  function onUrlChange() {
    lastSentSignature = null;
    scheduleDetect();
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
  document.addEventListener('click', event => {
    if (event.target.closest('.job-card-container, .jobs-search-results__list-item, [data-job-id], [href*="/jobs/view/"], [href*="jobs.ashbyhq.com"]')) {
      scheduleDetect();
    }
  }, true);

  function mutationTouchesJobContent(mutation) {
    const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;

    if (target && (target.closest(JOB_DETAIL_SELECTOR) || target.matches?.(JOB_DETAIL_SELECTOR))) {
      return true;
    }

    for (const node of mutation.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(JOB_DETAIL_SELECTOR) || node.querySelector?.(JOB_DETAIL_SELECTOR)) {
        return true;
      }
    }

    // Many ATS pages render into a generic SPA root, so the first useful
    // mutation may happen before a job-specific selector exists on the target.
    return hasJobUrlSignal() && target?.id === 'root';
  }

  const observer = new MutationObserver(mutations => {
    const shouldCheck = mutations.some(mutationTouchesJobContent);

    if (shouldCheck) scheduleDetect();
  });

  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  tryDetect();
})();
