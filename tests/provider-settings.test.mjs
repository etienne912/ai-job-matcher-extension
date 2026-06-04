import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProviderApiKey,
  getProviderModel,
  migrateProviderSettings
} from '../lib/provider-settings.js';

test('provider credentials are resolved independently', () => {
  const settings = {
    provider: 'openai',
    apiKeysByProvider: {
      openai: 'openai-key',
      anthropic: 'anthropic-key'
    },
    modelsByProvider: {
      openai: 'gpt-model',
      anthropic: 'claude-model'
    }
  };

  assert.equal(getProviderApiKey(settings, 'openai'), 'openai-key');
  assert.equal(getProviderApiKey(settings, 'anthropic'), 'anthropic-key');
  assert.equal(getProviderModel(settings, 'openai'), 'gpt-model');
  assert.equal(getProviderModel(settings, 'anthropic'), 'claude-model');
});

test('legacy provider credentials remain readable and migrate once', () => {
  const legacy = {
    provider: 'openai',
    apiKey: 'legacy-key',
    model: 'legacy-model'
  };

  assert.equal(getProviderApiKey(legacy, 'openai'), 'legacy-key');
  assert.equal(getProviderModel(legacy, 'openai'), 'legacy-model');
  assert.equal(getProviderApiKey(legacy, 'anthropic'), '');

  assert.deepEqual(migrateProviderSettings(legacy, 'openai'), {
    apiKeysByProvider: { openai: 'legacy-key' },
    modelsByProvider: { openai: 'legacy-model' }
  });
});

test('migration does not overwrite existing per-provider values', () => {
  const migrated = migrateProviderSettings({
    apiKey: 'legacy-key',
    model: 'legacy-model',
    apiKeysByProvider: { openai: 'current-key' },
    modelsByProvider: { openai: 'current-model' }
  }, 'openai');

  assert.deepEqual(migrated, {
    apiKeysByProvider: { openai: 'current-key' },
    modelsByProvider: { openai: 'current-model' }
  });
});
