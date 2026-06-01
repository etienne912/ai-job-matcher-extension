import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROVIDERS } from '../lib/providers.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

async function fileExists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function validateManifest() {
  const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

  assert(manifest.manifest_version === 3, 'manifest.json must use Manifest V3');
  assert(manifest.version === packageJson.version, 'manifest.json and package.json versions must match');
  assert(!manifest.host_permissions?.includes('<all_urls>'), 'host_permissions must not include <all_urls>');

  for (const iconPath of Object.values(manifest.icons || {})) {
    assert(await fileExists(iconPath), `Missing icon: ${iconPath}`);
  }

  for (const script of manifest.content_scripts || []) {
    for (const scriptPath of script.js || []) {
      assert(await fileExists(scriptPath), `Missing content script: ${scriptPath}`);
    }
  }

  assert(await fileExists(manifest.background.service_worker), 'Missing background service worker');
  assert(await fileExists(manifest.side_panel.default_path), 'Missing side panel HTML');
  assert(await fileExists(manifest.options_ui.page), 'Missing options HTML');
}

async function validateProviders() {
  const providerEntries = Object.entries(PROVIDERS);

  assert(providerEntries.length > 0, 'No providers configured');
  assert(PROVIDERS.ollama?.hasApiKey === false, 'Ollama should not require an API key');

  for (const [key, provider] of providerEntries) {
    assert(provider.name, `Provider ${key} is missing a display name`);
    assert(Array.isArray(provider.models), `Provider ${key} models must be an array`);
    assert(typeof provider.hasApiKey === 'boolean', `Provider ${key} hasApiKey must be boolean`);
  }
}

async function validateReadmeAssets() {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const imageRefs = [...readme.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)]
    .map(match => match[1])
    .filter(imageRef => !/^https?:\/\//i.test(imageRef));

  for (const imageRef of imageRefs) {
    assert(await fileExists(imageRef), `README references missing image: ${imageRef}`);
  }
}

await validateManifest();
await validateProviders();
await validateReadmeAssets();

console.log('Validation passed');
