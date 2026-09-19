/**
 * Provider registry.
 *
 * Adding a new web AI = create src/providers/<id>.js extending WebAIProvider,
 * add it to config/default.json providers.<id>, and register it here.
 * Nothing else in the codebase needs to change.
 *
 * `experimental: true` marks a provider whose selectors were written from the
 * published DOM structure but not verified against a live signed-in session.
 * Experimental providers ship disabled by default; users opt in via
 * config/local.json once they have confirmed the selectors still match.
 */

import DeepSeekProvider from './deepseek.js';
import DuckAIProvider from './duckai.js';
import ChatGPTProvider from './chatgpt.js';
import GrokProvider from './grok.js';
import QwenProvider from './qwen.js';
import GeminiProvider from './gemini.js';

export const PROVIDER_CLASSES = {
  duckai: DuckAIProvider,
  qwen: QwenProvider,
  deepseek: DeepSeekProvider,
  chatgpt: ChatGPTProvider,
  grok: GrokProvider,
  gemini: GeminiProvider,
};

/** Providers whose selectors have NOT been verified against a live session. */
export const EXPERIMENTAL_PROVIDERS = new Set(['gemini', 'grok']);

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
    const err = new Error(
      `Provider "${id}" is disabled in config.` +
        (EXPERIMENTAL_PROVIDERS.has(id)
          ? ' This provider is experimental: its selectors are unverified. Enable it in config/local.json after confirming it works for you.'
          : ''),
    );
    err.code = 'provider_disabled';
    throw err;
  }
  return new Cls(id, settings, config);
}

export function knownProviderIds() {
  return Object.keys(PROVIDER_CLASSES);
}

export function isExperimental(id) {
  return EXPERIMENTAL_PROVIDERS.has(id);
}
