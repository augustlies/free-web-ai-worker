/**
 * Rate-limit guard: keep this tool's usage indistinguishable from careful
 * human use, so web AI providers never see a burst pattern.
 *
 * Four layers, all opt-out-able but ON by default:
 *
 *   1. MIN INTERVAL   — at least N seconds between two calls to the same site
 *   2. COOLDOWN       — after every K calls, take a longer rest
 *   3. DAILY QUOTA    — hard ceiling per site per day
 *   4. CIRCUIT BREAKER— on captcha_required / access_blocked, stop calling that
 *                       site for a while instead of hammering it
 *
 * State is persisted in <profileDir>/throttle.json so limits survive across
 * CLI invocations (each of which is a separate process).
 *
 * This module never bypasses a provider limit. It only makes us quieter.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './logger.js';

const STATE_FILE = 'throttle.json';

/** Defaults; override via config.throttle. */
export const DEFAULT_THROTTLE = {
  enabled: true,
  /** Minimum seconds between two calls to the SAME provider. */
  minIntervalSeconds: 20,
  /** After `cooldownEvery` calls, wait `cooldownSeconds` instead. */
  cooldownEvery: 8,
  cooldownSeconds: 180,
  /** Hard cap per provider per rolling 24h. */
  dailyQuota: 40,
  /** After a captcha/block, refuse calls for this long. */
  breakerSeconds: 1800,
  /** Random jitter added to every wait so timing never looks robotic. */
  jitterSeconds: 8,
};

function statePath(profileDir) {
  return join(profileDir, STATE_FILE);
}

export function readState(profileDir) {
  try {
    const file = statePath(profileDir);
    if (!existsSync(file)) return { providers: {} };
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { providers: {} };
  } catch {
    return { providers: {} };
  }
}

function writeState(profileDir, state) {
  try {
    mkdirSync(profileDir, { recursive: true });
    writeFileSync(statePath(profileDir), JSON.stringify(state, null, 2));
  } catch (err) {
    log.debug('could not persist throttle state', { error: err.message });
  }
}

function entryFor(state, providerId) {
  state.providers ||= {};
  state.providers[providerId] ||= {
    lastCallAt: 0,
    callsToday: 0,
    windowStartedAt: 0,
    breakerUntil: 0,
    history: [],
  };
  return state.providers[providerId];
}

function pruneHistory(entry, now) {
  const cutoff = now - 24 * 3600 * 1000;
  entry.history = (entry.history || []).filter((t) => t > cutoff);
}

/**
 * Decide whether a call may proceed right now.
 *
 * @returns {{allowed:boolean, waitMs:number, reason?:string, remainingToday?:number}}
 */
export function checkAllowed(profileDir, providerId, throttle) {
  const cfg = { ...DEFAULT_THROTTLE, ...(throttle || {}) };
  if (!cfg.enabled) return { allowed: true, waitMs: 0, reason: 'throttle disabled' };

  const now = Date.now();
  const state = readState(profileDir);
  const entry = entryFor(state, providerId);
  pruneHistory(entry, now);

  // 4. circuit breaker
  if (entry.breakerUntil && now < entry.breakerUntil) {
    const waitMs = entry.breakerUntil - now;
    return {
      allowed: false,
      waitMs,
      reason:
        `circuit breaker active for ${providerId} (the site recently showed a captcha or blocked us). ` +
        `Wait ${Math.ceil(waitMs / 1000)}s or use another provider.`,
    };
  }

  // 3. daily quota
  const usedToday = entry.history.length;
  if (usedToday >= cfg.dailyQuota) {
    return {
      allowed: false,
      waitMs: 0,
      reason:
        `daily quota reached for ${providerId} (${usedToday}/${cfg.dailyQuota} calls in the last 24h). ` +
        'This cap exists to avoid triggering anti-abuse systems. Try another provider or wait.',
      remainingToday: 0,
    };
  }

  // 1 + 2. spacing and cooldown
  let requiredGapMs = cfg.minIntervalSeconds * 1000;
  const isCooldownCall = cfg.cooldownEvery > 0 && usedToday > 0 && usedToday % cfg.cooldownEvery === 0;
  if (isCooldownCall) requiredGapMs = Math.max(requiredGapMs, cfg.cooldownSeconds * 1000);

  const elapsed = now - (entry.lastCallAt || 0);
  let waitMs = Math.max(0, requiredGapMs - elapsed);
  if (waitMs > 0) waitMs += Math.floor(Math.random() * cfg.jitterSeconds * 1000);

  return {
    allowed: true,
    waitMs,
    reason: waitMs > 0 ? (isCooldownCall ? 'cooldown after a batch of calls' : 'minimum interval between calls') : undefined,
    requiredGapMs,
    isCooldownCall,
    usedToday,
    remainingToday: cfg.dailyQuota - usedToday,
  };
}

/** Record a successful call. */
export function recordSuccess(profileDir, providerId) {
  const now = Date.now();
  const state = readState(profileDir);
  const entry = entryFor(state, providerId);
  pruneHistory(entry, now);
  entry.lastCallAt = now;
  entry.history.push(now);
  entry.windowStartedAt ||= now;
  writeState(profileDir, state);
}

/**
 * Trip the circuit breaker. Called when a provider answers with a captcha or
 * access block, which is the clearest signal that we are being rate-limited.
 */
export function recordBlock(profileDir, providerId, throttle, reason) {
  const cfg = { ...DEFAULT_THROTTLE, ...(throttle || {}) };
  const state = readState(profileDir);
  const entry = entryFor(state, providerId);
  entry.breakerUntil = Date.now() + cfg.breakerSeconds * 1000;
  entry.lastBreakerReason = reason || 'captcha_or_block';
  writeState(profileDir, state);
  log.warn(`Pausing calls to ${providerId} for ${cfg.breakerSeconds}s`, { reason: entry.lastBreakerReason });
}

/** Record a call that failed for an unrelated reason (timeout, stale selector). */
export function recordAttempt(profileDir, providerId) {
  const now = Date.now();
  const state = readState(profileDir);
  const entry = entryFor(state, providerId);
  pruneHistory(entry, now);
  entry.lastCallAt = now;
  entry.history.push(now);
  writeState(profileDir, state);
}

/** Human-readable usage summary for the `limits` command. */
export function usageReport(profileDir, providerIds, throttle) {
  const cfg = { ...DEFAULT_THROTTLE, ...(throttle || {}) };
  const state = readState(profileDir);
  const now = Date.now();
  return providerIds.map((id) => {
    const entry = entryFor(state, id);
    pruneHistory(entry, now);
    const use = checkAllowed(profileDir, id, cfg);
    return {
      provider: id,
      usedToday: entry.history.length,
      dailyQuota: cfg.dailyQuota,
      remainingToday: Math.max(0, cfg.dailyQuota - entry.history.length),
      secondsSinceLastCall: entry.lastCallAt ? Math.round((now - entry.lastCallAt) / 1000) : null,
      breakerActive: !!(entry.breakerUntil && now < entry.breakerUntil),
      breakerEndsInSeconds: entry.breakerUntil > now ? Math.ceil((entry.breakerUntil - now) / 1000) : 0,
      nextCallAllowedInSeconds: use.allowed ? Math.ceil((use.waitMs || 0) / 1000) : null,
      blockedReason: use.allowed ? null : use.reason,
    };
  });
}
