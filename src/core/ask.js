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
 *   - Never bypasses logins/CAPTCHAs/rate limits. If a site wants a human, we
 *     report it and stop. Throttling makes us quieter, never pushier.
 *   - One browser, one tab per call: cheap, isolated, no cross-prompt leakage.
 *   - Answer cache + per-provider throttle sit in front of the browser so that
 *     repeated or rapid use cannot turn into an abusive traffic pattern.
 */

import { loadConfig } from './config.js';
import { ErrorCodes, WebAIError, toWebAIError } from './errors.js';
import { configureLogger, log } from './logger.js';
import { ensureBrowser, detach, openPage, resolveBrowser, profileDirFor } from './browser.js';
import { captureFailure } from './artifacts.js';
import { checkAllowed, recordSuccess, recordAttempt, recordBlock } from './throttle.js';
import { cacheGet, cachePut } from './cache.js';
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
    noThrottle: !!o.noThrottle,
    noCache: !!o.noCache,
    cacheTtlSeconds: Number(o.cacheTtlSeconds ?? cfg.cache?.ttlSeconds ?? 3600),
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
 * @param {boolean} [options.noThrottle]   skip interval/quota/breaker checks
 * @param {boolean} [options.noCache]      bypass the answer cache
 * @param {number}  [options.cacheTtlSeconds]
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
  const throttleCfg = cfg.throttle;

  // Resolve the profile directory up front — throttle and cache state live there.
  const activeBrowser = resolveBrowser(cfg);
  const profileDir = activeBrowser ? profileDirFor(cfg, activeBrowser.id) : cfg.browser.profileDir;

  log.info('ask_web_ai start', { provider: providerId, chars: prompt.length, timeoutMs });

  if (opts.dryRun) {
    const provider = createProvider(providerId, cfg);
    return { status: 'success', provider: providerId, answer: null, meta: { dryRun: true, url: provider.url, promptChars: prompt.length } };
  }

  // ---- cache ---------------------------------------------------------------
  if (cfg.cache?.enabled !== false && !opts.noCache) {
    const hit = cacheGet(profileDir, providerId, prompt, opts.cacheTtlSeconds);
    if (hit) {
      log.info('ask_web_ai success (from cache)', { provider: providerId, chars: hit.answer.length });
      return {
        status: 'success',
        provider: providerId,
        answer: hit.answer,
        meta: { ...hit.meta, model: cfg.providers?.[providerId]?.displayName || providerId, startedAt, elapsedMs: 0, chars: hit.answer.length },
      };
    }
  }

  // ---- throttle ------------------------------------------------------------
  if (!opts.noThrottle) {
    const gate = checkAllowed(profileDir, providerId, throttleCfg);
    if (!gate.allowed) {
      log.warn('Call refused by the rate-limit guard', { provider: providerId, reason: gate.reason });
      return {
        status: 'error',
        provider: providerId,
        error: gate.reason,
        code: ErrorCodes.RATE_LIMITED_LOCALLY,
        details: {
          provider: providerId,
          waitSeconds: Math.ceil((gate.waitMs || 0) / 1000) || null,
          remainingToday: gate.remainingToday ?? null,
          suggestion: 'Wait as indicated, use another provider, or lower throttle strictness in config/local.json.',
        },
        meta: { startedAt },
      };
    }
    if (gate.waitMs > 0) {
      log.info(`Waiting ${Math.ceil(gate.waitMs / 1000)}s before calling ${providerId}`, { reason: gate.reason });
      await new Promise((r) => setTimeout(r, gate.waitMs));
    }
  }

  let browser = null;
  let page = null;
  let provider = null;

  try {
    provider = createProvider(providerId, cfg);
    const { browser: b, context, browserInfo } = await ensureBrowser(cfg, { initialUrl: provider.url });
    browser = b;

    page = await openPage(context, provider.url, { waitMs: Math.max(30000, Math.min(timeoutMs, 60000)) });
    log.debug('Page opened', { provider: providerId, url: page.url() });

    const { answer, url, elapsedMs } = await provider.ask(page, prompt, {
      timeoutMs,
      stableMs: opts.stableMs,
      pollMs: opts.pollMs,
    });

    if (!opts.noThrottle) recordSuccess(profileDir, providerId);

    const capped = answer.length > cfg.defaults.maxAnswerChars ? answer.slice(0, cfg.defaults.maxAnswerChars) : answer;
    log.info('ask_web_ai success', { provider: providerId, chars: capped.length, elapsed: `${Math.round(elapsedMs / 1000)}s` });

    const meta = {
      model: cfg.providers?.[providerId]?.displayName || providerId,
      url,
      chars: capped.length,
      truncated: capped.length !== answer.length,
      elapsedMs,
      startedAt,
      browser: browserInfo?.id,
      cached: false,
    };

    if (cfg.cache?.enabled !== false && !opts.noCache) {
      cachePut(profileDir, providerId, prompt, capped, meta);
    }

    return { status: 'success', provider: providerId, answer: capped, meta };
  } catch (err) {
    const e = toWebAIError(err, ErrorCodes.INTERNAL);
    log.error('ask_web_ai failed', { provider: providerId, code: e.code, error: e.message });

    if (!opts.noThrottle) {
      // A captcha or a network block is the provider telling us to slow down.
      if (e.code === ErrorCodes.CAPTCHA_REQUIRED || e.code === ErrorCodes.ACCESS_BLOCKED) {
        recordBlock(profileDir, providerId, throttleCfg, e.code);
      } else {
        recordAttempt(profileDir, providerId);
      }
    }

    const artifacts = await captureFailure(page, profileDir, providerId, { code: e.code, error: e.message });
    return e.toResult(providerId, {
      meta: { startedAt, url: safeUrl(page), browser: activeBrowser?.id, ...(artifacts ? { artifacts } : {}) },
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
