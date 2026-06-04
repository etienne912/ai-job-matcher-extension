import { PROVIDERS } from './lib/providers.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const providerSel    = $('provider');
const apiKeyInput    = $('api-key');
const btnShowKey     = $('btn-show-key');
const fieldApiKey    = $('field-api-key');
const modelSel       = $('model');
const btnRefreshModels = $('btn-refresh-models');
const modelStatus    = $('model-status');
const btnTest        = $('btn-test');
const testResult     = $('test-result');
const cvInput        = $('cv');
const cvChars        = $('cv-chars');
const btnImportCv    = $('btn-import-cv');
const cvFileInput    = $('cv-file');
const savedFlash     = $('saved-flash');
const autoAnalysisMode = $('auto-analysis-mode');

// Requirement fields
const targetTitles   = $('target-titles');
const salaryMin      = $('salary-min');
const currency       = $('currency');
const arrRemote      = $('arr-remote');
const arrHybrid      = $('arr-hybrid');
const arrOnsite      = $('arr-onsite');
const preferredInds  = $('preferred-industries');
const targetLocations = $('target-locations');
const mustHave       = $('must-have-skills');
const dealBreakers   = $('deal-breakers');
const notes          = $('notes');

// ── Provider / model UI ───────────────────────────────────────────────────────
let modelLoadId = 0;

async function populateModels(provider, savedModel = null) {
  const loadId = ++modelLoadId;
  const info = PROVIDERS[provider];
  modelSel.innerHTML = '';
  modelSel.disabled = false;
  modelStatus.classList.add('hidden');
  modelStatus.classList.remove('err');
  btnRefreshModels.classList.toggle('hidden', provider !== 'ollama');
  fieldApiKey.classList.toggle('hidden', !info.hasApiKey);

  let models = info.models;

  if (provider === 'ollama') {
    modelSel.innerHTML = '<option value="">Loading models...</option>';
    modelSel.disabled = true;
    btnRefreshModels.disabled = true;

    try {
      const response = await chrome.runtime.sendMessage({ type: 'FETCH_OLLAMA_MODELS' });
      if (loadId !== modelLoadId) return;
      if (response?.error) throw new Error(response.error);
      models = Array.isArray(response?.models) ? response.models : [];
      modelSel.innerHTML = '';

      if (models.length === 0) {
        modelSel.innerHTML = '<option value="">No local models installed</option>';
        modelStatus.textContent = 'Install a model with Ollama, then refresh this list.';
        modelStatus.classList.remove('hidden');
      }
    } catch (err) {
      if (loadId !== modelLoadId) return;
      console.error('Ollama models fetch failed:', err);
      modelSel.innerHTML = '<option value="">Unable to load local models</option>';
      modelStatus.textContent = `${err.message}. Ensure Ollama is running, then refresh the list.`;
      modelStatus.classList.add('err');
      modelStatus.classList.remove('hidden');
      models = [];
    }

    modelSel.disabled = models.length === 0;
    btnRefreshModels.disabled = false;
  }

  if (models.length > 0) {
    models.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      modelSel.appendChild(opt);
    });
    if (savedModel && models.includes(savedModel)) {
      modelSel.value = savedModel;
    }
  } else if (provider !== 'ollama') {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No models available';
    modelSel.appendChild(opt);
  }
}

providerSel.addEventListener('change', async () => {
  await populateModels(providerSel.value);
  save();
});

btnRefreshModels.addEventListener('click', async () => {
  await populateModels('ollama', modelSel.value);
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

// ── Import CV ─────────────────────────────────────────────────────────────────
btnImportCv.addEventListener('click', () => {
  cvFileInput.click();
});

cvFileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
    const reader = new FileReader();
    reader.onload = (event) => {
      cvInput.value = event.target.result;
      cvChars.textContent = cvInput.value.length.toLocaleString();
      save();
    };
    reader.readAsText(file);
  } else if (file.type === 'application/pdf' || file.name.endsWith('.pdf') || file.name.endsWith('.docx')) {
    extractTextWithAI(file);
  } else {
    alert('Unsupported file type. Please use a .txt file or copy-paste your CV.');
  }
  
  // Reset input so the same file can be selected again
  cvFileInput.value = '';
});

async function extractTextWithAI(file) {
  const originalText = btnImportCv.textContent;
  btnImportCv.textContent = 'Extracting...';
  btnImportCv.disabled = true;

  try {
    const reader = new FileReader();
    const base64Promise = new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
    });
    reader.readAsDataURL(file);
    const base64Data = await base64Promise;

    const provider = providerSel.value;
    const apiKey   = apiKeyInput.value;
    const model    = modelSel.value;

    if (!model) throw new Error('Select a model first in AI Provider settings.');
    if (provider !== 'ollama' && !apiKey) throw new Error('Enter an API key first in AI Provider settings.');

    const response = await aiRequest({
      provider,
      apiKey,
      model,
      systemPrompt: 'You are a document text extractor. Extract ALL the text content from the provided file exactly as it appears. Do not add commentary or formatting, just the raw text content.',
      userPrompt: 'Extract the text from this file.',
      fileData: {
        base64: base64Data,
        mimeType: file.type || (file.name.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
        fileName: file.name
      }
    });

    if (response.error) throw new Error(response.error);
    
    cvInput.value = response.text;
    cvChars.textContent = cvInput.value.length.toLocaleString();
    save();
    
    btnImportCv.textContent = 'Imported!';
    setTimeout(() => {
      btnImportCv.textContent = originalText;
    }, 2000);
  } catch (err) {
    console.error('Text extraction failed:', err);
    alert('Failed to extract text: ' + err.message);
    btnImportCv.textContent = originalText;
  } finally {
    btnImportCv.disabled = false;
  }
}

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
  const model = modelSel.value;

  chrome.storage.local.set({
    provider,
    apiKey: apiKeyInput.value,
    model,
    autoAnalysisMode:   autoAnalysisMode.value,
    cv: cvInput.value,
    targetTitles:        targetTitles.value,
    salaryMin:           salaryMin.value,
    currency:            currency.value,
    targetLocations:     targetLocations.value,
    workArrangement:     getWorkArrangement(),
    preferredIndustries: preferredInds.value,
    mustHaveSkills:      mustHave.value,
    dealBreakers:        dealBreakers.value,
    notes:               notes.value
  }, flashSaved);
}

// Attach save to all input/change/textarea events
[
  apiKeyInput, modelSel, cvInput, targetTitles, salaryMin,
  currency, autoAnalysisMode, preferredInds, targetLocations, mustHave, dealBreakers, notes
].forEach(el => el.addEventListener('input', save));

[autoAnalysisMode, arrRemote, arrHybrid, arrOnsite].forEach(el => el.addEventListener('change', save));

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
  const model    = modelSel.value;

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
chrome.storage.local.get(null, async (settings) => {
  const provider = settings.provider || 'anthropic';
  providerSel.value = provider;
  apiKeyInput.value = settings.apiKey || '';

  cvInput.value = settings.cv || '';
  cvChars.textContent = cvInput.value.length.toLocaleString();
  autoAnalysisMode.value = settings.autoAnalysisMode || 'auto';

  targetTitles.value  = settings.targetTitles        || '';
  salaryMin.value     = settings.salaryMin            || '';
  currency.value      = settings.currency             || '£';
  preferredInds.value = settings.preferredIndustries  || '';
  targetLocations.value = settings.targetLocations   || '';
  mustHave.value      = settings.mustHaveSkills       || '';
  dealBreakers.value  = settings.dealBreakers         || '';
  notes.value         = settings.notes               || '';

  const arr = settings.workArrangement || {};
  arrRemote.checked  = !!arr['Remote'];
  arrHybrid.checked  = !!arr['Hybrid'];
  arrOnsite.checked  = !!arr['On-site'];

  await populateModels(provider, settings.model);
  if (modelSel.value && modelSel.value !== settings.model) {
    chrome.storage.local.set({ model: modelSel.value });
  }
});
