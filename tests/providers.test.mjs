import test from 'node:test';
import assert from 'node:assert/strict';
import { callProvider, fetchOllamaModels } from '../lib/providers.js';

const basePayload = {
  provider: 'openai',
  apiKey: 'test-key',
  model: 'test-model',
  systemPrompt: 'System',
  userPrompt: 'User',
  staticPrompt: 'Static profile',
  dynamicPrompt: 'Dynamic job'
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('callProvider validates required model and API key', async () => {
  await assert.rejects(
    callProvider({ ...basePayload, model: '' }),
    /No model selected/
  );

  await assert.rejects(
    callProvider({ ...basePayload, apiKey: '' }),
    /Missing API key/
  );
});

test('OpenAI request splits static and dynamic prompts', async () => {
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return jsonResponse({
      choices: [{ message: { content: 'OK' } }]
    });
  };

  const text = await callProvider(basePayload);

  assert.equal(text, 'OK');
  assert.equal(requestBody.model, 'test-model');
  assert.deepEqual(requestBody.messages.map(message => message.role), ['system', 'user', 'user']);
  assert.equal(requestBody.messages[1].content, 'Static profile');
  assert.equal(requestBody.messages[2].content, 'Dynamic job');
});

test('Gemini provider parses API error messages', async () => {
  globalThis.fetch = async () => jsonResponse({
    error: { message: 'Invalid Gemini key' }
  }, 403);

  await assert.rejects(
    callProvider({
      ...basePayload,
      provider: 'gemini'
    }),
    /Invalid Gemini key/
  );
});

test('Anthropic provider rejects empty text responses', async () => {
  globalThis.fetch = async () => jsonResponse({
    content: []
  });

  await assert.rejects(
    callProvider({
      ...basePayload,
      provider: 'anthropic'
    }),
    /empty or unsupported/
  );
});

test('OpenAI file payload includes document data URL and filename', async () => {
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    return jsonResponse({
      choices: [{ message: { content: 'Extracted text' } }]
    });
  };

  const text = await callProvider({
    ...basePayload,
    userPrompt: 'Extract',
    fileData: {
      base64: 'abc123',
      mimeType: 'application/pdf',
      fileName: 'cv.pdf'
    }
  });

  assert.equal(text, 'Extracted text');
  const filePart = requestBody.messages[1].content.find(part => part.type === 'file');
  assert.equal(filePart.file.file_name, 'cv.pdf');
  assert.equal(filePart.file.file_data, 'data:application/pdf;base64,abc123');
});

test('Ollama model discovery filters empty model names', async () => {
  globalThis.fetch = async () => jsonResponse({
    models: [{ name: 'llama3.1' }, { name: '' }, {}]
  });

  const models = await fetchOllamaModels();

  assert.deepEqual(models, ['llama3.1']);
});

test('Ollama rejects non-image file extraction before fetch', async () => {
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return jsonResponse({});
  };

  await assert.rejects(
    callProvider({
      ...basePayload,
      provider: 'ollama',
      apiKey: '',
      fileData: {
        base64: 'abc123',
        mimeType: 'application/pdf',
        fileName: 'cv.pdf'
      }
    }),
    /doesn't support direct PDF\/DOCX/
  );

  assert.equal(fetchCalled, false);
});
