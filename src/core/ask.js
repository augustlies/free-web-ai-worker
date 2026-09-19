/**
 * askWebAI — the single public entry point of this project.
 *
 *   const result = await askWebAI({ prompt, provider });
 *   // success: { status:'success', provider, answer, meta }
 *   // error:   { status:'error',   provider, error, code }
 *
 * Design notes
 *   - Always returns a structured object; it never throws for expected errors.
 *     Agents consuming this are bad at try/catch and good at reading JSON.
 *   - Never bypasses logins/CAPTCHAs. If a site wants a human, we report
 *     login_required and let the user sign in once in the visible window.
 *   - One browser, one tab per call: cheap, isolated, no cross-prompt leakage.
 */

import { loadConfig } from './config.js';
import { ErrorCodes, WebAIError, toWebAIError } from './errors.js';
import { configureLogger, log } from './logger.js';
import { ensureBrowser, detach, openPage } from './browser.js';
import { captureFailure } from './artifacts.js';
import { createProvider, knownProviderIds } from '../providers/index.js';

function normaliseOptions(options) {
  const cfg = loadConfig();
  const o = options || {};
  const prompt = typeof o.prompt === 'string' ? o.prompt : '';
  if (!prompt.trim()) {
    throw new WebAIError('prompt must be a non-empty string', ErrorCodes.INVALID_INPUT);
  }

  const provider = (o.provider || cfg.defaults.provider || 'duckai').toLowerCase();
  if (!knownProviderIds().includes(provider)) {
    throw new WebAIError(
      `Unknown provider "${provider}". Known providers: ${knownProviderIds().join(', ')}`,
      ErrorCodes.UNKNOWN_PROVIDER,
      { knownProviders: knownProviderIds() },
    );
  }

  const settings = cfg.providers?.[provider] || {};
  if (settings.enabled === false) {
    throw new WebAIError(`Provider "${provider}" is disabled in config`, ErrorCodes.PROVIDER_DISABLED, { provider });
  }

  const timeoutMs = Number(o.timeoutMs ?? cfg.defaults.timeoutMs);
  const stableMs = Number(o.stableMs ?? cfg.defaults.stableMs);
  const pollMs = Number(o.pollMs ?? cfg.defaults.pollMs);

  if (!Number.isFinite(timeoutMs) || timeoutMs < 5000) {
    throw new WebAIError('timeoutMs must be a number >= 5000', ErrorCodes.INVALID_INPUT);
  }

  return {
    cfg,
    prompt,
    provider,
    timeoutMs,
    stableMs,
    pollMs,
    logLevel: o.logLevel || cfg.logging.level || 'info',
    dryRun: !!o.dryRun,
  };
}

/**
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} [options.provider]      default from config
 * @param {number} [options.timeoutMs]
 * @param {number} [options.stableMs]
 * @param {string} [options.logLevel]      silent|error|warn|info|debug
 * @param {(line:string)=>void} [options.onLog]
 * @param {boolean} [options.dryRun]       resolve config/provider only, no browser
 * @returns {Promise<object>} structured result — never throws
 */
export async function askWebAI(options = {}) {
  let opts;
  try {
    opts = normaliseOptions(options);
  } catch (err) {
    const e = toWebAIError(err, ErrorCodes.INVALID_INPUT);
    return e.toResult(options?.provider ?? null);
  }

  configureLogger({ level: opts.logLevel, onLine: options.onLog });
  const { cfg, prompt, provider: providerId, timeoutMs } = opts;
  const startedAt = new Date().toISOString();

  log.info('ask_web_ai start', { provider: providerId, chars: prompt.length, timeoutMs });

  if (opts.dryRun) {
    const provider = createProvider(providerId, cfg);
    return {
      status: 'success',
      provider: providerId,
      answer: null,
      meta: { dryRun: true, url: provider.url, promptChars: prompt.length },
    };
  }

  let browser = null;
  let page = null;
  let provider = null;

  try {
    provider = createProvider(providerId, cfg);
    const { browser: b, context } = await ensureBrowser(cfg, { initialUrl: provider.url });
    browser = b;

    page = await openPage(context, provider.url, { waitMs: Math.max(30000, Math.min(timeoutMs, 60000)) });
    log.debug('Page opened', { provider: providerId, url: page.url() });

    const { answer, url, elapsedMs } = await provider.ask(page, prompt, {
      timeoutMs,
      stableMs: opts.stableMs,
      pollMs: opts.pollMs,
    });

    const capped = answer.length > cfg.defaults.maxAnswerChars ? answer.slice(0, cfg.defaults.maxAnswerChars) : answer;
    log.info('ask_web_ai success', { provider: providerId, chars: capped.length, elapsed: `${Math.round(elapsedMs / 1000)}s` });

    return {
      status: 'success',
      provider: providerId,
      answer: capped,
      meta: {
        model: cfg.providers?.[providerId]?.displayName || providerId,
        url,
        chars: capped.length,
        truncated: capped.length !== answer.length,
        elapsedMs,
        startedAt,
      },
    };
  } catch (err) {
    const e = toWebAIError(err, ErrorCodes.INTERNAL);
    log.error('ask_web_ai failed', { provider: providerId, code: e.code, error: e.message });
    const artifacts = await captureFailure(page, cfg, providerId, { code: e.code, error: e.message });
    return e.toResult(providerId, {
      meta: { startedAt, url: safeUrl(page), ...(artifacts ? { artifacts } : {}) },
    });
  } finally {
    if (page) await page.close().catch(() => {});
    if (browser) await detach(browser);
    log.debug('cleanup complete', { provider: providerId });
  }
}

function safeUrl(page) {
  try {
    return page?.url ? page.url() : undefined;
  } catch {
    return undefined;
  }
}

export { ErrorCodes } from './errors.js';

