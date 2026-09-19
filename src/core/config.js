/**
 * Configuration loading.
 *
 * Resolution order (later wins):
 *   1. config/default.json (checked in)
 *   2. config/local.json   (git-ignored, machine specific)
 *   3. environment variables (AWA_*)
 *   4. explicit overrides passed to loadConfig()
 *
 * Config is kept separate from code so users can add providers or change
 * timeouts without touching source files.
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { ErrorCodes, WebAIError } from './errors.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..');

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && out[key] && typeof out[key] === 'object') {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new WebAIError(`Invalid JSON in ${path}: ${err.message}`, ErrorCodes.INVALID_INPUT);
  }
}

/** Expand a leading ~ and make relative paths absolute from the project root. */
export function expandPath(p) {
  if (!p) return p;
  let out = p;
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) {
    out = join(homedir(), out.slice(2));
  }
  return resolve(PROJECT_ROOT, out);
}

function envOverrides() {
  const out = {};
  const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
  const bool = (v) => (v === undefined ? undefined : /^(1|true|yes|on)$/i.test(v));

  const port = num(process.env.AWA_BROWSER_PORT);
  if (port !== undefined) out.browser = { ...(out.browser || {}), port };
  const headless = bool(process.env.AWA_HEADLESS);
  if (headless !== undefined) out.browser = { ...(out.browser || {}), headless };
  if (process.env.AWA_CHROME_PATH) out.browser = { ...(out.browser || {}), chromePath: process.env.AWA_CHROME_PATH };
  if (process.env.AWA_PROFILE_DIR) out.browser = { ...(out.browser || {}), profileDir: process.env.AWA_PROFILE_DIR };

  const timeout = num(process.env.AWA_TIMEOUT_MS);
  if (timeout !== undefined) out.defaults = { ...(out.defaults || {}), timeoutMs: timeout };
  if (process.env.AWA_PROVIDER) out.defaults = { ...(out.defaults || {}), provider: process.env.AWA_PROVIDER };
  if (process.env.AWA_LOG_LEVEL) out.logging = { ...(out.logging || {}), level: process.env.AWA_LOG_LEVEL };

  return out;
}

/**
 * @param {object} [overrides] explicit overrides (highest priority)
 * @returns {object} resolved config
 */
export function loadConfig(overrides = {}) {
  const base = readJsonIfExists(join(PROJECT_ROOT, 'config', 'default.json'));
  if (!base) {
    throw new WebAIError('config/default.json is missing', ErrorCodes.INTERNAL);
  }
  const local = readJsonIfExists(join(PROJECT_ROOT, 'config', 'local.json')) || {};
  const merged = deepMerge(deepMerge(deepMerge(base, local), envOverrides()), overrides);

  // Normalise profile dir into an absolute path once, here.
  if (merged.browser) {
    merged.browser.profileDir = expandPath(merged.browser.profileDir);
  }
  return merged;
}

export function listEnabledProviders(config) {
  return Object.entries(config.providers || {})
    .filter(([, p]) => p && p.enabled !== false)
    .map(([id, p]) => ({ id, ...p }));
}
