/**
 * Answer cache.
 *
 * The cheapest call is the one you never make. Identical prompts within the
 * TTL window return the previous answer, with meta.cached = true, so agents
 * that re-ask the same question do not create extra traffic.
 *
 * Cache is keyed by provider + prompt hash and stored as one JSON file per
 * entry under <profileDir>/cache/.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './logger.js';

const MAX_CACHE_FILES = 300;

export function cacheKey(providerId, prompt) {
  return createHash('sha256').update(`${providerId}\u0000${prompt}`).digest('hex').slice(0, 32);
}

function cacheDir(profileDir) {
  return join(profileDir, 'cache');
}

/**
 * @returns {{answer:string, meta:object}|null}
 */
export function cacheGet(profileDir, providerId, prompt, ttlSeconds) {
  try {
    const file = join(cacheDir(profileDir), `${cacheKey(providerId, prompt)}.json`);
    if (!existsSync(file)) return null;
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    const ageSeconds = (Date.now() - entry.storedAt) / 1000;
    if (ageSeconds > ttlSeconds) return null;
    log.info('Cache hit — skipping the web AI call entirely', {
      provider: providerId,
      ageSeconds: Math.round(ageSeconds),
    });
    return { answer: entry.answer, meta: { ...entry.meta, cached: true, cacheAgeSeconds: Math.round(ageSeconds) } };
  } catch {
    return null;
  }
}

export function cachePut(profileDir, providerId, prompt, answer, meta) {
  try {
    const dir = cacheDir(profileDir);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${cacheKey(providerId, prompt)}.json`);
    writeFileSync(file, JSON.stringify({ provider: providerId, promptPreview: prompt.slice(0, 200), answer, meta, storedAt: Date.now() }, null, 2));
    pruneCache(dir);
  } catch (err) {
    log.debug('cache write failed', { error: err.message });
  }
}

/** Keep the cache directory from growing without bound. */
function pruneCache(dir) {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({ f, path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const { path } of files.slice(MAX_CACHE_FILES)) rmSync(path, { force: true });
  } catch {
    /* best effort */
  }
}

/** Clear all cached answers (used by `cache --clear`). */
export function cacheClear(profileDir) {
  try {
    const dir = cacheDir(profileDir);
    if (!existsSync(dir)) return 0;
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    for (const f of files) rmSync(join(dir, f), { force: true });
    return files.length;
  } catch {
    return 0;
  }
}

export function cacheStats(profileDir) {
  try {
    const dir = cacheDir(profileDir);
    if (!existsSync(dir)) return { entries: 0, dir };
    return { entries: readdirSync(dir).filter((f) => f.endsWith('.json')).length, dir };
  } catch {
    return { entries: 0, dir: cacheDir(profileDir) };
  }
}
