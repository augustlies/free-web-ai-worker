/**
 * Public API entry point.
 *
 *   import { askWebAI } from 'free-web-ai-worker';
 *
 *   const result = await askWebAI({ prompt: 'Summarise this: ...' });
 *   if (result.status === 'success') console.log(result.answer);
 *
 * Everything else in src/ is internal and may change without notice.
 */

export { askWebAI } from './core/ask.js';
export { ErrorCodes, WebAIError } from './core/errors.js';
export { loadConfig, listEnabledProviders } from './core/config.js';
export { knownProviderIds, createProvider } from './providers/index.js';
export { WebAIProvider } from './core/provider.js';
