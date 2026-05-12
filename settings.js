'use strict';

// ── Provider metadata (mirrors lib/providers.js without the fetch calls) ──────
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic (Claude)',
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
    hasApiKey: true
  },
  openai: {
    name: 'OpenAI',
    models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.5-instant', 'o4-mini', 'gpt-4o'],
    hasApiKey: true
  },
  gemini: {
    name: 'Google Gemini',
    models: ['gemini-3.1-pro', 'gemini-3.1-flash', 'gemini-3.0-flash'],
    hasApiKey: true
  },
  ollama: {
    name: 'Ollama (local)',
    models: [],
    hasApiKey: false
  },
  mistral: {
    name: 'Mistral AI',
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest'],
    hasApiKey: true
  }
};

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const providerSel    = $('provider');
const apiKeyInput    = $('api-key');
const btnShowKey     = $('btn-show-key');
const fieldApiKey    = $('field-api-key');
const modelSel       = $('model');
const modelCustom    = $('model-custom');
const btnTest        = $('btn-test');
const testResult     = $('test-result');
const cvInput        = $('cv');
const cvChars        = $('cv-chars');
const savedFlash     = $('saved-flash');

// Requirement fields
const targetTitles   = $('target-titles');
const salaryMin      = $('salary-min');
const currency       = $('currency');
const arrRemote      = $('arr-remote');
const arrHybrid      = $('arr-hybrid');
const arrOnsite      = $('arr-onsite');
const preferredInds  = $('preferred-industries');
const mustHave       = $('must-have-skills');
const dealBreakers   = $('deal-breakers');
const notes          = $('notes');

// ── Provider / model UI ───────────────────────────────────────────────────────
async function populateModels(provider, savedModel = null) {
  const info = PROVIDERS[provider];
  modelSel.innerHTML = '';
  modelCustom.classList.add('hidden');
  modelSel.classList.remove('hidden');

  let models = info.models;

  if (provider === 'ollama') {
    modelSel.innerHTML = '<option value="">Loading models...</option>';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'FETCH_OLLAMA_MODELS' });
      if (response.error) throw new Error(response.error);
      models = response.models;
      modelSel.innerHTML = '';
      if (models.length === 0) {
         throw new Error('No models found');
      }
    } catch (err) {
      console.error('Ollama models fetch failed:', err);
      modelSel.classList.add('hidden');
      modelCustom.classList.remove('hidden');
      models = [];
    }
  }

  if (models.length > 0) {
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      modelSel.appendChild(opt);
    });
    if (savedModel) {
      modelSel.value = savedModel;
    }
  } else if (provider !== 'ollama') {
    // Fallback if no models for other providers (shouldn't happen with static list)
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No models available';
    modelSel.appendChild(opt);
  } else if (provider === 'ollama' && modelSel.innerHTML === '') {
    // If ollama failed and we are showing custom input, or if no models found
    modelSel.classList.add('hidden');
    modelCustom.classList.remove('hidden');
  }

  fieldApiKey.classList.toggle('hidden', !info.hasApiKey);
}

providerSel.addEventListener('change', () => {
  populateModels(providerSel.value);
  save();
});

// ── API key show/hide ─────────────────────────────────────────────────────────
btnShowKey.addEventListener('click', () => {
  const isHidden = apiKeyInput.type === 'password';
  apiKeyInput.type = isHidden ? 'text' : 'password';
  btnShowKey.textContent = isHidden ? 'Hide' : 'Show';
});

// ── Character count ───────────────────────────────────────────────────────────
cvInput.addEventListener('input', () => {
  cvChars.textContent = cvInput.value.length.toLocaleString();
});

// ── Auto-save ─────────────────────────────────────────────────────────────────
let saveTimer = null;

function flashSaved() {
  savedFlash.classList.add('visible');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => savedFlash.classList.remove('visible'), 1800);
}

function getWorkArrangement() {
  return {
    Remote:   arrRemote.checked,
    Hybrid:   arrHybrid.checked,
    'On-site': arrOnsite.checked
  };
}

function save() {
  const provider = providerSel.value;
  const model = (provider === 'ollama' && modelSel.classList.contains('hidden')) 
    ? modelCustom.value 
    : modelSel.value;

  chrome.storage.local.set({
    provider,
    apiKey: apiKeyInput.value,
    model,
    cv: cvInput.value,
    targetTitles:        targetTitles.value,
    salaryMin:           salaryMin.value,
    currency:            currency.value,
    workArrangement:     getWorkArrangement(),
    preferredIndustries: preferredInds.value,
    mustHaveSkills:      mustHave.value,
    dealBreakers:        dealBreakers.value,
    notes:               notes.value
  }, flashSaved);
}

// Attach save to all input/change/textarea events
[
  apiKeyInput, modelSel, modelCustom, cvInput, targetTitles, salaryMin,
  currency, preferredInds, mustHave, dealBreakers, notes
].forEach(el => el.addEventListener('input', save));

[arrRemote, arrHybrid, arrOnsite].forEach(el => el.addEventListener('change', save));

// Handle Ctrl+S / Cmd+S to save settings
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault();
    save();
  }
});

// ── Port-based AI request (mirrors sidebar.js — keeps service worker alive) ───
function aiRequest(payload) {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'ai-request' });
    port.onMessage.addListener((msg) => {
      if (msg.error) reject(new Error(msg.error));
      else resolve(msg);
    });
    port.onDisconnect.addListener(() => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
    });
    port.postMessage(payload);
  });
}

// ── Test connection ───────────────────────────────────────────────────────────
btnTest.addEventListener('click', async () => {
  testResult.textContent = 'Testing…';
  testResult.className = '';
  btnTest.disabled = true;

  const provider = providerSel.value;
  const apiKey   = apiKeyInput.value;
  const model    = (provider === 'ollama' && modelSel.classList.contains('hidden')) 
    ? modelCustom.value 
    : modelSel.value;

  if (!model) {
    testResult.textContent = 'Select a model first.';
    testResult.className = 'err';
    btnTest.disabled = false;
    return;
  }
  if (provider !== 'ollama' && !apiKey) {
    testResult.textContent = 'Enter an API key first.';
    testResult.className = 'err';
    btnTest.disabled = false;
    return;
  }

  try {
    const response = await aiRequest({
      provider,
      apiKey,
      model,
      systemPrompt: 'You are a test assistant. Reply with exactly: OK',
      userPrompt: 'Reply with exactly: OK'
    });

    if (response.error) throw new Error(response.error);
    testResult.textContent = '✓ Connection successful';
    testResult.className = 'ok';
  } catch (err) {
    testResult.textContent = '✗ ' + err.message;
    testResult.className = 'err';
  } finally {
    btnTest.disabled = false;
  }
});

// ── Load saved settings ────────────────────────────────────────────────────────
chrome.storage.local.get(null, (settings) => {
  const provider = settings.provider || 'anthropic';
  providerSel.value = provider;
  populateModels(provider, settings.model);

  apiKeyInput.value = settings.apiKey || '';

  if (provider === 'ollama' && !modelSel.classList.contains('hidden')) {
     // Model selection is handled by populateModels for dropdown
  } else if (provider === 'ollama') {
    modelCustom.value = settings.model || '';
  } else {
    if (settings.model) modelSel.value = settings.model;
  }

  cvInput.value = settings.cv || '';
  cvChars.textContent = cvInput.value.length.toLocaleString();

  targetTitles.value  = settings.targetTitles        || '';
  salaryMin.value     = settings.salaryMin            || '';
  currency.value      = settings.currency             || '£';
  preferredInds.value = settings.preferredIndustries  || '';
  mustHave.value      = settings.mustHaveSkills       || '';
  dealBreakers.value  = settings.dealBreakers         || '';
  notes.value         = settings.notes               || '';

  const arr = settings.workArrangement || {};
  arrRemote.checked  = !!arr['Remote'];
  arrHybrid.checked  = !!arr['Hybrid'];
  arrOnsite.checked  = !!arr['On-site'];
});
