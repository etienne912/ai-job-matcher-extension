'use strict';

const CIRCUMFERENCE = 2 * Math.PI * 54; // 339.29

// ── DOM refs ────────────────────────────────────────────────────────────────
const states = {
  loading:  document.getElementById('state-loading'),
  noCv:     document.getElementById('state-no-cv'),
  notJob:   document.getElementById('state-not-job'),
  error:    document.getElementById('state-error'),
  results:  document.getElementById('state-results'),
  history:  document.getElementById('state-history')
};

const el = {
  scoreRing:           document.getElementById('score-ring'),
  scoreLabel:          document.getElementById('score-label'),
  jobTitle:            document.getElementById('job-title-text'),
  company:             document.getElementById('company-text'),
  verdictBanner:       document.getElementById('verdict-banner'),
  criteriaList:        document.getElementById('criteria-list'),
  fullAnalysisBody:    document.getElementById('full-analysis-body'),
  partialError:        document.getElementById('partial-error'),
  errorMsg:            document.getElementById('error-message'),
  dealbreakerWarning:  document.getElementById('dealbreaker-warning'),
  historyList:         document.getElementById('history-list')
};

// ── State helpers ────────────────────────────────────────────────────────────
let previousState = 'loading';
function showState(name) {
  Object.entries(states).forEach(([k, s]) => {
    if (!s.classList.contains('hidden')) previousState = k;
    s.classList.add('hidden');
  });
  states[name].classList.remove('hidden');
}

// ── History ──────────────────────────────────────────────────────────────────
function renderHistory(historyItems) {
  el.historyList.innerHTML = '';
  
  if (!historyItems || historyItems.length === 0) {
    el.historyList.innerHTML = '<div class="history-empty">No history yet. Analyse some jobs!</div>';
    return;
  }

  historyItems.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="history-info">
        <span class="history-job-title">${escHtml(item.jobTitle || 'Unknown Job')}</span>
        <span class="history-company">${escHtml(item.company || 'Unknown Company')}</span>
      </div>
      <div class="history-score" style="color: ${getScoreColor(item.score)}">${item.score}%</div>
    `;
    
    div.addEventListener('click', () => {
      renderResults(item, false);
      if (item.url) {
        window.open(item.url, '_blank');
      }
    });
    
    el.historyList.appendChild(div);
  });
}

function getScoreColor(score) {
  if (score >= 70)      return '#3B6D11';
  else if (score >= 40) return '#854F0B';
  else                  return '#A32D2D';
}

// ── Score ring ───────────────────────────────────────────────────────────────
function updateScoreRing(score) {
  const offset = CIRCUMFERENCE * (1 - score / 100);
  el.scoreRing.style.strokeDashoffset = offset;
  el.scoreLabel.textContent = score + '%';
  el.scoreRing.style.stroke = getScoreColor(score);
}

// ── Criteria rendering ───────────────────────────────────────────────────────
const BADGE_LABELS = { match: 'Match', partial: 'Partial', mismatch: 'Mismatch', unknown: 'Unknown' };

function renderCriteria(criteria) {
  el.criteriaList.innerHTML = '';
  criteria.forEach(({ label, note, status }) => {
    const item = document.createElement('div');
    item.className = 'criteria-item';
    item.innerHTML = `
      <span class="criteria-label">${escHtml(label)}</span>
      <span class="criteria-note">${escHtml(note || '')}</span>
      <span class="criteria-badge badge-${escHtml(status || 'unknown')}">${BADGE_LABELS[status] || 'Unknown'}</span>
    `;
    el.criteriaList.appendChild(item);
  });
  el.criteriaList.classList.remove('hidden');
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Render results ───────────────────────────────────────────────────────────
function renderResults(analysis, isPartial) {
  showState('results');

  if (isPartial) {
    el.partialError.classList.remove('hidden');
    el.verdictBanner.classList.add('hidden');
    el.criteriaList.classList.add('hidden');
    el.dealbreakerWarning.classList.add('hidden');
    el.scoreLabel.textContent = '—';
    el.scoreRing.style.strokeDashoffset = CIRCUMFERENCE;
    el.scoreRing.style.stroke = '#5F5E5A';
    el.jobTitle.textContent = '';
    el.company.textContent = '';
  } else {
    el.partialError.classList.add('hidden');
    updateScoreRing(analysis.score ?? 0);

    const titleParts = [analysis.jobTitle, analysis.company].filter(Boolean);
    el.jobTitle.textContent = analysis.jobTitle || '';
    el.company.textContent = analysis.company || '';

    if (analysis.verdict) {
      el.verdictBanner.textContent = analysis.verdict;
      el.verdictBanner.classList.remove('hidden');
    } else {
      el.verdictBanner.classList.add('hidden');
    }

    const dealbreakerHit = Array.isArray(analysis.criteria) &&
      analysis.criteria.some(c => c.label === 'Deal-breakers' && c.status === 'mismatch');
    el.dealbreakerWarning.classList.toggle('hidden', !dealbreakerHit);

    if (Array.isArray(analysis.criteria) && analysis.criteria.length) {
      renderCriteria(analysis.criteria);
    }
  }

  el.fullAnalysisBody.textContent = analysis.fullAnalysis || analysis.rawText || '';
}

// ── Messaging helpers ────────────────────────────────────────────────────────
function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// AI requests use a persistent port so Chrome doesn't kill the service worker
// mid-fetch — critical for slow/local providers like Ollama.
function aiRequest(payload) {
  return new Promise((resolve, reject) => {
    let connected = true;
    const port = chrome.runtime.connect({ name: 'ai-request' });

    // Keep-alive heartbeat to prevent Service Worker from going idle during long requests
    const heartbeat = setInterval(() => {
      if (connected) {
        try {
          port.postMessage({ type: 'PING' });
        } catch (e) {
          // Port might have closed
        }
      }
    }, 15000);

    const cleanup = () => {
      connected = false;
      clearInterval(heartbeat);
    };

    port.onMessage.addListener((msg) => {
      cleanup();
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg);
      port.disconnect();
    });

    port.onDisconnect.addListener(() => {
      if (connected) {
        cleanup();
        const err = chrome.runtime.lastError;
        reject(new Error(err ? err.message : 'Connection closed unexpectedly'));
      }
    });

    port.postMessage(payload);
  });
}

// ── Prompt builders ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a job application assistant. Your role is to objectively compare a job listing against a candidate's CV and their stated job requirements, then return a structured JSON assessment.
Return ONLY valid JSON — no markdown fences, no explanation outside the JSON.`;

function buildStaticPrompt(settings) {
  const arrangements = Object.entries(settings.workArrangement || {})
    .filter(([, v]) => v).map(([k]) => k).join(', ') || 'Not specified';

  return `Candidate CV
${settings.cv || '(not provided)'}

Candidate job requirements
Target titles: ${settings.targetTitles || 'Not specified'}
Salary minimum: ${settings.salaryMin || 'Not specified'} ${settings.currency || ''}
Work arrangement preference: ${arrangements}
Preferred industries: ${settings.preferredIndustries || 'Not specified'}
Must-have skills:
${settings.mustHaveSkills || 'Not specified'}
Deal-breakers:
${settings.dealBreakers || 'Not specified'}
Additional notes: ${settings.notes || 'None'}

Task
Analyse the job listing and return a JSON object with this exact structure:
{
  "score": <integer 0-100>,
  "jobTitle": "<extracted job title>",
  "company": "<extracted company name>",
  "verdict": "<one sentence plain English summary>",
  "criteria": [
    {"label": "Skills match",     "note": "<brief observation>", "status": "match" | "partial" | "mismatch" | "unknown"},
    {"label": "Seniority level",  "note": "<brief observation>", "status": "match" | "partial" | "mismatch" | "unknown"},
    {"label": "Salary",           "note": "<brief observation>", "status": "match" | "partial" | "mismatch" | "unknown"},
    {"label": "Work arrangement", "note": "<brief observation>", "status": "match" | "partial" | "mismatch" | "unknown"},
    {"label": "Industry",         "note": "<brief observation>", "status": "match" | "partial" | "mismatch" | "unknown"},
    {"label": "Deal-breakers",    "note": "<brief observation>", "status": "match" | "partial" | "mismatch" | "unknown"}
  ],
  "fullAnalysis": "<3-5 paragraphs of detailed honest assessment>"
}`;
}

function buildDynamicPrompt(jobText) {
  return `Job listing text\n${jobText}`;
}

function buildUserPrompt(settings, jobText) {
  return buildStaticPrompt(settings) + '\n\n' + buildDynamicPrompt(jobText);
}

// ── Core analysis flow ───────────────────────────────────────────────────────
async function runAnalysis(jobText) {
  showState('loading');

  const settings = await new Promise(resolve =>
    chrome.storage.local.get(null, resolve)
  );

  if (!settings.cv || !settings.cv.trim()) {
    showState('noCv');
    return;
  }

  const provider = settings.provider || 'anthropic';
  const apiKey = settings.apiKey || '';
  const model = settings.model || '';

  if (!model) {
    showError('No model selected. Open settings to configure an AI provider.');
    return;
  }
  if (provider !== 'ollama' && !apiKey) {
    showError('No API key configured. Open settings to add your API key.');
    return;
  }

  try {
    const response = await aiRequest({
      provider,
      apiKey,
      model,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(settings, jobText),
      staticPrompt: buildStaticPrompt(settings),
      dynamicPrompt: buildDynamicPrompt(jobText)
    }).catch(err => {
      // Specifically handle the "port closed" message to be more helpful
      if (err.message.includes('message port closed')) {
        throw new Error('Analysis timed out or connection was lost. If using a local model, ensure it is running.');
      }
      throw err;
    });

    if (response.error) throw new Error(response.error);

    let analysis;
    let isPartial = false;

    try {
      // Strip accidental markdown fences
      const cleaned = response.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      analysis = JSON.parse(cleaned);
    } catch {
      isPartial = true;
      analysis = { rawText: response.text, fullAnalysis: response.text };
    }

    // Cache in session storage and history
    await sendMessage({ type: 'SAVE_ANALYSIS', analysis: { ...analysis, isPartial } })
      .catch(err => console.warn('Failed to cache analysis:', err));

    renderResults(analysis, isPartial);
  } catch (err) {
    showError(err.message || 'Unknown error');
  }
}

function showError(msg) {
  el.errorMsg.textContent = msg;
  showState('error');
}

// ── Init ─────────────────────────────────────────────────────────────────────
let currentJobText = null;

async function init() {
  // 1. Check for a cached analysis first
  const cached = await sendMessage({ type: 'GET_ANALYSIS' }).catch(() => ({ analysis: null }));
  if (cached && cached.analysis) {
    renderResults(cached.analysis, cached.analysis.isPartial);
    return;
  }

  // 2. Get job text from background (checks session store → content script)
  const jobData = await sendMessage({ type: 'GET_JOB_TEXT' }).catch(() => ({ text: null }));
  if (!jobData || !jobData.text) {
    showState('notJob');
    return;
  }

  currentJobText = jobData.text;
  await runAnalysis(currentJobText);
}

// ── Event listeners ──────────────────────────────────────────────────────────
function openSettings() {
  chrome.runtime.openOptionsPage();
}

document.getElementById('btn-settings-header').addEventListener('click', openSettings);
document.getElementById('btn-open-settings').addEventListener('click', openSettings);
document.getElementById('btn-go-settings').addEventListener('click', openSettings);

document.getElementById('btn-history').addEventListener('click', async () => {
  const { history = [] } = await chrome.storage.local.get('history');
  renderHistory(history);
  showState('history');
});

document.getElementById('btn-back-from-history').addEventListener('click', () => {
  // If we have results, go back to results, otherwise initial state
  showState(previousState === 'history' ? 'notJob' : previousState);
});

document.getElementById('btn-close').addEventListener('click', () => {
  // Chrome Side Panel has no close API; minimise by navigating away or just signal intent
  window.close();
});

document.getElementById('btn-reanalyse').addEventListener('click', async () => {
  await sendMessage({ type: 'CLEAR_ANALYSIS' }).catch(() => {});
  const jobData = await sendMessage({ type: 'GET_JOB_TEXT' }).catch(() => ({ text: null }));
  currentJobText = jobData.text;
  if (!currentJobText) { showState('notJob'); return; }
  await runAnalysis(currentJobText);
});

document.getElementById('btn-retry').addEventListener('click', async () => {
  if (currentJobText) {
    await runAnalysis(currentJobText);
  } else {
    await init();
  }
});

document.getElementById('btn-analyse-anyway').addEventListener('click', async () => {
  const jobData = await sendMessage({ type: 'GET_JOB_TEXT' }).catch(() => ({ text: null }));
  currentJobText = jobData.text;
  if (!currentJobText) {
    showError('Could not extract text from this page.');
    return;
  }
  await runAnalysis(currentJobText);
});

// Listen for new job detections or tab changes
chrome.runtime.onMessage.addListener(async (message) => {
  if (message.type === 'JOB_DETECTED') {
    currentJobText = message.text;
    
    // Check if we have a cached analysis for this new URL (via history or session)
    const cached = await sendMessage({ type: 'GET_ANALYSIS' }).catch(() => ({ analysis: null }));
    if (cached.analysis) {
      renderResults(cached.analysis, cached.analysis.isPartial);
    } else {
      runAnalysis(currentJobText);
    }
  } else if (message.type === 'TAB_CHANGED') {
    // Re-initialize for the new active tab
    init();
  }
});

document.addEventListener('DOMContentLoaded', init);
// Also fire immediately if DOMContentLoaded already fired
if (document.readyState !== 'loading') init();
