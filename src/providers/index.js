/**
 * Provider registry.
 *
 * Adding a new web AI = create src/providers/<id>.js extending WebAIProvider,
 * add it to config/default.json providers.<id>, and register it here.
 * Nothing else in the codebase needs to change.
 */

import GeminiProvider from './gemini.js';
import DeepSeekProvider from './deepseek.js';
import DuckAIProvider from './duckai.js';
import ChatGPTProvider from './chatgpt.js';
import GrokProvider from './grok.js';
import QwenProvider from './qwen.js';

export const PROVIDER_CLASSES = {
  gemini: GeminiProvider,
  deepseek: DeepSeekProvider,
  duckai: DuckAIProvider,
  chatgpt: ChatGPTProvider,
  grok: GrokProvider,
  qwen: QwenProvider,
};

/**
 * Instantiate a provider, or throw a structured error the caller can return.
 * @param {string} id
 * @param {object} config resolved configuration
 */
export function createProvider(id, config) {
  const Cls = PROVIDER_CLASSES[id];
  if (!Cls) {
    const known = Object.keys(PROVIDER_CLASSES).join(', ');
    const err = new Error(`Unknown provider "${id}". Known providers: ${known}`);
    err.code = 'unknown_provider';
    err.knownProviders = Object.keys(PROVIDER_CLASSES);
    throw err;
  }
  const settings = (config.providers || {})[id] || {};
  return new Cls(id, settings, config);
}

export function knownProviderIds() {
  return Object.keys(PROVIDER_CLASSES);
}
