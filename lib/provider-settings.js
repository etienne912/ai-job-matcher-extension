export function getProviderApiKey(settings, provider) {
  return settings.apiKeysByProvider?.[provider]
    ?? (settings.provider === provider ? settings.apiKey : '')
    ?? '';
}

export function getProviderModel(settings, provider) {
  return settings.modelsByProvider?.[provider]
    ?? (settings.provider === provider ? settings.model : '')
    ?? '';
}

export function migrateProviderSettings(settings, provider) {
  const apiKeysByProvider = { ...(settings.apiKeysByProvider || {}) };
  const modelsByProvider = { ...(settings.modelsByProvider || {}) };

  if (settings.apiKey && !apiKeysByProvider[provider]) {
    apiKeysByProvider[provider] = settings.apiKey;
  }
  if (settings.model && !modelsByProvider[provider]) {
    modelsByProvider[provider] = settings.model;
  }

  return { apiKeysByProvider, modelsByProvider };
}
