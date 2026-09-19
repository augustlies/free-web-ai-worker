/**
 * Provider registry.
 *
 * Adding a new web AI = create src/providers/<id>.js extending WebAIProvider,
 * add it to config/default.json providers.<id>, and register it here.
 * Nothing else in the codebase needs to change.
 *
 * Gemini is intentionally NOT registered: it was removed at the user's request.
 * config/default.json still carries a disabled "gemini" block documenting why,
 * so re-enabling it means restoring the import + entry below and setting
 * providers.gemini.enabled = true.
 */

import DeepSeekProvider from './deepseek.js';
import DuckAIProvider from './duckai.js';
import ChatGPTProvider from './chatgpt.js';
import GrokProvider from './grok.js';
import QwenProvider from './qwen.js';

export const PROVIDER_CLASSES = {
  duckai: DuckAIProvider,
  qwen: QwenProvider,
  deepseek: DeepSeekProvider,
  chatgpt: ChatGPTProvider,
  grok: GrokProvider,
};

/**
 * Instantiate a provider, or throw a structured error the caller can return.
 * @param {string} id
 * @param {object} config resolved configuration
 */
export function createProvider(id, config) {
  const Cls = PROVIDER_CLASSES[id];
  if (!Cls) {
    const known = knownProviderIds().join(', ');
    const err = new Error(`Unknown provider "${id}". Known providers: ${known}`);
    err.code = 'unknown_provider';
    err.knownProviders = knownProviderIds();
    throw err;
  }
  const settings = (config.providers || {})[id] || {};
  if (settings.enabled === false) {
    const err = new Error(`Provider "${id}" is disabled in config`);
    err.code = 'provider_disabled';
    throw err;
  }
  return new Cls(id, settings, config);
}

export function knownProviderIds() {
  return Object.keys(PROVIDER_CLASSES);
}
