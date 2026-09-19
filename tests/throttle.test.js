/**
 * Unit tests for the anti-abuse guard and the answer cache.
 * No browser, no network. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAllowed, recordSuccess, recordBlock, recordAttempt, usageReport, DEFAULT_THROTTLE } from '../src/core/throttle.js';
import { cacheGet, cachePut, cacheClear, cacheStats } from '../src/core/cache.js';

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'awa-test-'));
}

test('throttle: first call is allowed with no wait', () => {
  const dir = freshDir();
  try {
    const r = checkAllowed(dir, 'duckai', DEFAULT_THROTTLE);
    assert.equal(r.allowed, true);
    assert.equal(r.waitMs, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throttle: a second immediate call must wait for the minimum interval', () => {
  const dir = freshDir();
  try {
    recordSuccess(dir, 'duckai');
    const r = checkAllowed(dir, 'duckai', { ...DEFAULT_THROTTLE, jitterSeconds: 0 });
    assert.equal(r.allowed, true);
    assert.ok(r.waitMs > 0, 'expected a positive wait');
    assert.ok(r.waitMs <= DEFAULT_THROTTLE.minIntervalSeconds * 1000, 'wait should not exceed the interval');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throttle: daily quota blocks further calls', () => {
  const dir = freshDir();
  try {
    const cfg = { ...DEFAULT_THROTTLE, dailyQuota: 3, jitterSeconds: 0 };
    for (let i = 0; i < 3; i++) recordSuccess(dir, 'duckai');
    const r = checkAllowed(dir, 'duckai', cfg);
    assert.equal(r.allowed, false);
    assert.match(r.reason, /daily quota/i);
    assert.equal(r.remainingToday, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throttle: circuit breaker blocks after a captcha/block report', () => {
  const dir = freshDir();
  try {
    recordBlock(dir, 'deepseek', DEFAULT_THROTTLE, 'captcha_required');
    const r = checkAllowed(dir, 'deepseek', DEFAULT_THROTTLE);
    assert.equal(r.allowed, false);
    assert.match(r.reason, /circuit breaker/i);
    assert.ok(r.waitMs > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throttle: limits are tracked per provider, not globally', () => {
  const dir = freshDir();
  try {
    recordSuccess(dir, 'duckai');
    const other = checkAllowed(dir, 'qwen', { ...DEFAULT_THROTTLE, jitterSeconds: 0 });
    assert.equal(other.waitMs, 0, 'a different provider should not be affected');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throttle: can be disabled entirely', () => {
  const dir = freshDir();
  try {
    recordSuccess(dir, 'duckai');
    const r = checkAllowed(dir, 'duckai', { ...DEFAULT_THROTTLE, enabled: false });
    assert.equal(r.allowed, true);
    assert.equal(r.waitMs, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('throttle: usage report summarises per-provider state', () => {
  const dir = freshDir();
  try {
    recordSuccess(dir, 'duckai');
    recordAttempt(dir, 'qwen');
    const report = usageReport(dir, ['duckai', 'qwen', 'chatgpt'], DEFAULT_THROTTLE);
    const byId = Object.fromEntries(report.map((r) => [r.provider, r]));
    assert.equal(byId.duckai.usedToday, 1);
    assert.equal(byId.qwen.usedToday, 1);
    assert.equal(byId.chatgpt.usedToday, 0);
    assert.ok(byId.duckai.secondsSinceLastCall !== null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: identical prompt returns the stored answer', () => {
  const dir = freshDir();
  try {
    cachePut(dir, 'duckai', '什么是板块构造？', '答案内容', { url: 'https://duck.ai/' });
    const hit = cacheGet(dir, 'duckai', '什么是板块构造？', 3600);
    assert.ok(hit, 'expected a cache hit');
    assert.equal(hit.answer, '答案内容');
    assert.equal(hit.meta.cached, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: different providers or prompts are kept separate', () => {
  const dir = freshDir();
  try {
    cachePut(dir, 'duckai', 'same prompt', 'duck answer', {});
    cachePut(dir, 'qwen', 'same prompt', 'qwen answer', {});
    assert.equal(cacheGet(dir, 'duckai', 'same prompt', 3600).answer, 'duck answer');
    assert.equal(cacheGet(dir, 'qwen', 'same prompt', 3600).answer, 'qwen answer');
    assert.equal(cacheGet(dir, 'duckai', 'other prompt', 3600), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: entries older than the TTL are ignored', () => {
  const dir = freshDir();
  try {
    cachePut(dir, 'duckai', 'p', 'a', {});
    assert.ok(cacheGet(dir, 'duckai', 'p', 3600));
    assert.equal(cacheGet(dir, 'duckai', 'p', -1), null, 'negative TTL should treat it as expired');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cache: clear removes entries and stats report the count', () => {
  const dir = freshDir();
  try {
    cachePut(dir, 'duckai', 'a', '1', {});
    cachePut(dir, 'duckai', 'b', '2', {});
    assert.equal(cacheStats(dir).entries, 2);
    assert.equal(cacheClear(dir), 2);
    assert.equal(cacheStats(dir).entries, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
