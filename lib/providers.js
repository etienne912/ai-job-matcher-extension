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
    models: ['mistral-small-latest', 'mistral-medium-latest', 'mistral-large-latest', 'pixtral-12b-2409', 'pixtral-large-latest', 'mistral-ocr-latest'],
    hasApiKey: true
  }
};

export async function callProvider({ provider, apiKey, model, systemPrompt, userPrompt, staticPrompt, dynamicPrompt, fileData }) {
  switch (provider) {
    case 'anthropic': return callAnthropic(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData);
    case 'openai':    return callOpenAI(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData);
    case 'gemini':    return callGemini(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData);
    case 'ollama':    return callOllama(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, model, 1200000, fileData);
    case 'mistral':   return callMistral(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

export async function fetchOllamaModels() {
  try {
    const response = await fetch('http://localhost:11434/api/tags');
    if (!response.ok) {
      throw new Error(`Ollama error: ${response.status}`);
    }
    const data = await response.json();
    return data.models.map(m => m.name);
  } catch (err) {
    console.error('Failed to fetch Ollama models:', err);
    throw new Error(`Ollama unreachable: ${err.message}`);
  }
}

async function callAnthropic(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData) {
  const messages = [];
  
  if (fileData) {
    const isImage = fileData.mimeType.startsWith('image/');
    const content = [
      {
        type: isImage ? 'image' : 'document',
        source: {
          type: 'base64',
          media_type: fileData.mimeType,
          data: fileData.base64
        }
      }
    ];

    if (staticPrompt && dynamicPrompt) {
      content.push({ type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } });
      content.push({ type: 'text', text: dynamicPrompt });
    } else {
      content.push({ type: 'text', text: userPrompt });
    }

    messages.push({ role: 'user', content });
  } else {
    const userContent = (staticPrompt && dynamicPrompt)
      ? [
          { type: 'text', text: staticPrompt, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: dynamicPrompt }
        ]
      : userPrompt;
    messages.push({ role: 'user', content: userContent });
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
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
      max_tokens: 4096,
      system: systemPrompt,
      messages
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Anthropic API error ${response.status}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

async function callOpenAI(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData) {
  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  if (fileData) {
    if (fileData.mimeType.startsWith('image/')) {
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: `data:${fileData.mimeType};base64,${fileData.base64}` } }
        ]
      });
    } else {
      // Support for PDF/DOCX via the new 'file' content type (GPT-4o/o1/o3-mini)
      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { 
            type: 'file', 
            file: { 
              file_data: `data:${fileData.mimeType};base64,${fileData.base64}`,
              file_name: 'document' + (fileData.mimeType === 'application/pdf' ? '.pdf' : '')
            } 
          }
        ]
      });
    }
  } else if (staticPrompt && dynamicPrompt) {
    messages.push({ role: 'user', content: staticPrompt });
    messages.push({ role: 'user', content: dynamicPrompt });
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_completion_tokens: 5048
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI API error ${response.status}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callGemini(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  let contents;
  if (fileData) {
    contents = [{
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
  } else if (staticPrompt && dynamicPrompt) {
    contents = [
      { role: 'user', parts: [{ text: staticPrompt }] },
      { role: 'user', parts: [{ text: dynamicPrompt }] }
    ];
  } else {
    contents = [{ role: 'user', parts: [{ text: userPrompt }] }];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: 5048 }
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error ${response.status}`);
  }
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callMistral(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, apiKey, model, fileData) {
  if (fileData && model === 'mistral-ocr-latest') {
    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        document: {
          type: fileData.mimeType.startsWith('image/') ? 'image_url' : 'document_url',
          [fileData.mimeType.startsWith('image/') ? 'image_url' : 'document_url']: `data:${fileData.mimeType};base64,${fileData.base64}`
        }
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Mistral OCR error ${response.status}`);
    }
    const data = await response.json();
    return data.pages.map(p => p.markdown).join('\n\n');
  }

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  if (fileData) {
    let content = [];
    if (fileData.mimeType.startsWith('image/')) {
      content.push({ type: 'text', text: userPrompt });
      content.push({ type: 'image_url', image_url: `data:${fileData.mimeType};base64,${fileData.base64}` });
    } else {
      // PDF or other documents in Chat API
      content.push({ type: 'document_url', document_url: `data:${fileData.mimeType};base64,${fileData.base64}` });
      content.push({ type: 'text', text: userPrompt });
    }
    messages.push({ role: 'user', content });
  } else if (staticPrompt && dynamicPrompt) {
    messages.push({ role: 'user', content: staticPrompt });
    messages.push({ role: 'user', content: dynamicPrompt });
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 5048
    })
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || err.message || `Mistral API error ${response.status}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callOllama(systemPrompt, staticPrompt, dynamicPrompt, userPrompt, model, timeoutMs = 1200000, fileData) {

  // Timeout controller
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  if (fileData) {
    messages.push({
      role: 'user',
      content: userPrompt,
      images: fileData.mimeType.startsWith('image/') ? [fileData.base64] : undefined
    });
    if (!fileData.mimeType.startsWith('image/')) {
       // Ollama doesn't support PDF directly in chat api usually, unless using specialized models/tools.
       throw new Error("Ollama doesn't support direct PDF/DOCX extraction via this API yet. Please use Anthropic or Gemini.");
    }
  } else if (staticPrompt && dynamicPrompt) {
    messages.push({ role: 'user', content: staticPrompt });
    messages.push({ role: 'user', content: dynamicPrompt });
  } else {
    messages.push({ role: 'user', content: userPrompt });
  }

  let response;
  try {
    response = await fetch('http://localhost:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages,
        options: {
          num_ctx: 5048,       // keep context manageable
        },
        stream: false
      })
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama request timed out after ${timeoutMs / 1000}s`);
    }
    throw new Error(`Ollama unreachable: ${err.message}`);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const detail = (() => { try { return JSON.parse(body).error; } catch { return body; } })();
    throw new Error(`Ollama ${response.status}: ${detail || 'unknown error'}`);
  }

  const data = await response.json();
  return data.message.content;
}