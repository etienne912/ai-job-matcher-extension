const DEFAULT_MAX_TOKENS = 5048;
const ANTHROPIC_MAX_TOKENS = 4096;
const OLLAMA_TIMEOUT_MS = 1200000;

export const PROVIDERS = {
  anthropic: {
    name: 'Anthropic (Claude)',
    models: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-sonnet-4.5', 'claude-haiku-4-5-20251001'],
    hasApiKey: true
  },
  openai: {
    name: 'OpenAI',
    models: ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.5-mini', 'gpt-5.4-mini', 'gpt-4.1'],
    hasApiKey: true
  },
  gemini: {
    name: 'Google Gemini',
    models: ['gemini-3.5-flash', 'gemini-3.1-flash', 'gemini-3.1-pro', 'gemini-2.5-pro'],
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

const PROVIDER_CALLS = {
  anthropic: callAnthropic,
  openai: callOpenAI,
  gemini: callGemini,
  ollama: callOllama,
  mistral: callMistral
};

export async function callProvider(payload) {
  const { provider, apiKey, model } = payload;
  const providerInfo = PROVIDERS[provider];
  const handler = PROVIDER_CALLS[provider];

  if (!providerInfo || !handler) throw new Error(`Unknown provider: ${provider}`);
  if (!model) throw new Error(`No model selected for ${providerInfo.name}`);
  if (providerInfo.hasApiKey && !apiKey) throw new Error(`Missing API key for ${providerInfo.name}`);

  return handler(payload);
}

export async function fetchOllamaModels() {
  try {
    const data = await requestJson({
      url: 'http://localhost:11434/api/tags',
      providerName: 'Ollama'
    });

    return Array.isArray(data.models) ? data.models.map(m => m.name).filter(Boolean) : [];
  } catch (err) {
    throw new Error(`Ollama unreachable: ${err.message}`);
  }
}

async function callAnthropic({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData }) {
  const data = await requestJson({
    url: 'https://api.anthropic.com/v1/messages',
    providerName: 'Anthropic',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        system: systemPrompt,
        messages: buildAnthropicMessages({ staticPrompt, dynamicPrompt, userPrompt, fileData })
      })
    }
  });

  return requireText(data.content?.find(part => part.type === 'text')?.text || data.content?.[0]?.text, 'Anthropic');
}

async function callOpenAI({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData }) {
  const data = await requestJson({
    url: 'https://api.openai.com/v1/chat/completions',
    providerName: 'OpenAI',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: buildOpenAICompatibleMessages({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, fileData }),
        max_completion_tokens: DEFAULT_MAX_TOKENS
      })
    }
  });

  return requireText(data.choices?.[0]?.message?.content, 'OpenAI');
}

async function callGemini({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData }) {
  const data = await requestJson({
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    providerName: 'Gemini',
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: buildGeminiContents({ staticPrompt, dynamicPrompt, userPrompt, fileData }),
        generationConfig: { maxOutputTokens: DEFAULT_MAX_TOKENS }
      })
    }
  });

  return requireText(data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join(''), 'Gemini');
}

async function callMistral({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData }) {
  if (fileData && model === 'mistral-ocr-latest') {
    return callMistralOcr({ apiKey, model, fileData });
  }

  const data = await requestJson({
    url: 'https://api.mistral.ai/v1/chat/completions',
    providerName: 'Mistral',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: buildMistralMessages({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, fileData }),
        max_tokens: DEFAULT_MAX_TOKENS
      })
    }
  });

  return requireText(data.choices?.[0]?.message?.content, 'Mistral');
}

async function callMistralOcr({ apiKey, model, fileData }) {
  const isImage = isImageFile(fileData);
  const data = await requestJson({
    url: 'https://api.mistral.ai/v1/ocr',
    providerName: 'Mistral OCR',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        document: {
          type: isImage ? 'image_url' : 'document_url',
          [isImage ? 'image_url' : 'document_url']: toDataUrl(fileData)
        }
      })
    }
  });

  const text = Array.isArray(data.pages)
    ? data.pages.map(page => page.markdown || '').filter(Boolean).join('\n\n')
    : '';

  return requireText(text, 'Mistral OCR');
}

async function callOllama({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, model, fileData }) {
  if (fileData && !isImageFile(fileData)) {
    throw new Error("Ollama doesn't support direct PDF/DOCX extraction via this API yet. Please use Anthropic, Gemini, OpenAI, or Mistral.");
  }

  const data = await requestJson({
    url: 'http://localhost:11434/api/chat',
    providerName: 'Ollama',
    timeoutMs: OLLAMA_TIMEOUT_MS,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: buildOllamaMessages({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, fileData }),
        options: { num_ctx: DEFAULT_MAX_TOKENS },
        stream: false
      })
    }
  });

  return requireText(data.message?.content, 'Ollama');
}

function buildAnthropicMessages({ staticPrompt, dynamicPrompt, userPrompt, fileData }) {
  const content = [];

  if (fileData) {
    content.push({
      type: isImageFile(fileData) ? 'image' : 'document',
      source: {
        type: 'base64',
        media_type: fileData.mimeType,
        data: fileData.base64
      }
    });
  }

  if (staticPrompt && dynamicPrompt) {
    content.push({ type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } });
    content.push({ type: 'text', text: dynamicPrompt });
  } else {
    content.push({ type: 'text', text: userPrompt });
  }

  return [{ role: 'user', content: (fileData || (staticPrompt && dynamicPrompt)) ? content : userPrompt }];
}

function buildOpenAICompatibleMessages({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, fileData }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  if (fileData) {
    messages.push({ role: 'user', content: buildOpenAIFileContent(userPrompt, fileData) });
  } else if (staticPrompt && dynamicPrompt) {
    messages.push(...splitUserPrompts(staticPrompt, dynamicPrompt));
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  return messages;
}

function buildOpenAIFileContent(userPrompt, fileData) {
  if (isImageFile(fileData)) {
    return [
      { type: 'text', text: userPrompt },
      { type: 'image_url', image_url: { url: toDataUrl(fileData) } }
    ];
  }

  return [
    { type: 'text', text: userPrompt },
    {
      type: 'file',
      file: {
        file_data: toDataUrl(fileData),
        file_name: fileData.fileName || `document${fileData.mimeType === 'application/pdf' ? '.pdf' : ''}`
      }
    }
  ];
}

function buildGeminiContents({ staticPrompt, dynamicPrompt, userPrompt, fileData }) {
  if (fileData) {
    return [{
      role: 'user',
      parts: [
        { text: userPrompt },
        {
          inline_data: {
            mime_type: fileData.mimeType,
            data: fileData.base64
          }
        }
      ]
    }];
  }

  if (staticPrompt && dynamicPrompt) {
    return splitUserPrompts(staticPrompt, dynamicPrompt).map(message => ({
      role: 'user',
      parts: [{ text: message.content }]
    }));
  }

  return [{ role: 'user', parts: [{ text: userPrompt }] }];
}

function buildMistralMessages({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, fileData }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  if (fileData) {
    const content = isImageFile(fileData)
      ? [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: toDataUrl(fileData) }
        ]
      : [
          { type: 'document_url', document_url: toDataUrl(fileData) },
          { type: 'text', text: userPrompt }
        ];
    messages.push({ role: 'user', content });
  } else if (staticPrompt && dynamicPrompt) {
    messages.push(...splitUserPrompts(staticPrompt, dynamicPrompt));
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  return messages;
}

function buildOllamaMessages({ systemPrompt, staticPrompt, dynamicPrompt, userPrompt, fileData }) {
  const messages = [{ role: 'system', content: systemPrompt }];

  if (fileData) {
    messages.push({
      role: 'user',
      content: userPrompt,
      images: isImageFile(fileData) ? [fileData.base64] : undefined
    });
  } else if (staticPrompt && dynamicPrompt) {
    messages.push(...splitUserPrompts(staticPrompt, dynamicPrompt));
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  return messages;
}

function splitUserPrompts(staticPrompt, dynamicPrompt) {
  return [
    { role: 'user', content: staticPrompt },
    { role: 'user', content: dynamicPrompt }
  ];
}

async function requestJson({ url, providerName, init = {}, timeoutMs }) {
  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller?.signal || init.signal
    });

    const data = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(extractErrorMessage(data) || `${providerName} API error ${response.status}`);
    }

    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`${providerName} request timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function parseResponseBody(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { rawText: text };
  }
}

function extractErrorMessage(data) {
  return data.error?.message || data.error || data.message || data.rawText || null;
}

function requireText(value, providerName) {
  if (typeof value === 'string' && value.trim()) return value;
  throw new Error(`${providerName} returned an empty or unsupported response`);
}

function isImageFile(fileData) {
  return fileData?.mimeType?.startsWith('image/');
}

function toDataUrl(fileData) {
  return `data:${fileData.mimeType};base64,${fileData.base64}`;
}
