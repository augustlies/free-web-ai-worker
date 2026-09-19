/**
 * Unit tests — no browser required.  Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, listEnabledProviders, expandPath } from '../src/core/config.js';
import { WebAIError, ErrorCodes, toWebAIError } from '../src/core/errors.js';
import { createProvider, knownProviderIds, isExperimental } from '../src/providers/index.js';
import { askWebAI } from '../src/core/ask.js';
import { homedir } from 'node:os';

test('config loads defaults with a default provider', () => {
  const cfg = loadConfig();
  assert.ok(cfg.defaults.provider, 'has a default provider');
  assert.ok(cfg.browser.port > 0);
  assert.ok(cfg.browser.profileDir.includes('.agent-web-ai'));
  assert.ok(Object.keys(cfg.providers).length >= 3);
});

test('config expands ~ to the home directory', () => {
  const p = expandPath('~/.agent-web-ai/chrome-profile');
  assert.ok(p.startsWith(homedir()), `expected ${p} to start with ${homedir()}`);
});

test('every registered provider has a matching class and selectors', () => {
  // Disabled providers (e.g. experimental ones) still must be constructible
  // once enabled, so enable everything for this structural check.
  const base = loadConfig();
  const allEnabled = Object.fromEntries(
    Object.keys(base.providers).map((id) => [id, { ...base.providers[id], enabled: true }]),
  );
  const cfg = loadConfig({ providers: allEnabled });

  for (const id of knownProviderIds()) {
    const p = createProvider(id, cfg);
    assert.equal(p.id, id);
    assert.ok(p.url, `${id} has a url`);
    assert.ok(p.constructor.selectors.INPUT, `${id} declares INPUT selectors`);
    assert.ok(p.constructor.selectors.ANSWER, `${id} declares ANSWER selectors`);
  }
});

test('a disabled provider reports provider_disabled, not unknown_provider', () => {
  const cfg = loadConfig({ providers: { gemini: { enabled: false } } });
  try {
    createProvider('gemini', cfg);
    assert.fail('expected createProvider to throw for a disabled provider');
  } catch (err) {
    assert.equal(err.code, 'provider_disabled');
  }
});

test('experimental providers are marked as such', () => {
  assert.ok(isExperimental('gemini'), 'gemini should be flagged experimental');
  assert.ok(!isExperimental('duckai'), 'duckai is verified and must not be flagged');
});

test('unknown provider ids are rejected', () => {
  const cfg = loadConfig();
  assert.throws(() => createProvider('nope', cfg), /Unknown provider/);
});

test('WebAIError produces the documented result shape', () => {
  const err = new WebAIError('boom', ErrorCodes.LOGIN_REQUIRED, { url: 'https://example.com' });
  const r = err.toResult('gemini');
  assert.equal(r.status, 'error');
  assert.equal(r.provider, 'gemini');
  assert.equal(r.error, 'boom');
  assert.equal(r.code, 'login_required');
  assert.deepEqual(r.details, { url: 'https://example.com' });
});

test('toWebAIError passes through WebAIError and wraps others', () => {
  const original = new WebAIError('x', ErrorCodes.TIMEOUT);
  assert.equal(toWebAIError(original), original);
  const wrapped = toWebAIError(new Error('plain'));
  assert.equal(wrapped.name, 'WebAIError');
  assert.equal(wrapped.code, ErrorCodes.INTERNAL);
});

test('askWebAI returns a structured error for an empty prompt instead of throwing', async () => {
  const r = await askWebAI({ prompt: '   ' });
  assert.equal(r.status, 'error');
  assert.equal(r.code, 'invalid_input');
});

test('askWebAI rejects unknown providers with known_providers detail', async () => {
  const r = await askWebAI({ prompt: 'hi', provider: 'not-a-provider' });
  assert.equal(r.status, 'error');
  assert.equal(r.code, 'unknown_provider');
  assert.ok(Array.isArray(r.details.knownProviders));
});

test('askWebAI dry-run resolves a provider without launching a browser', async () => {
  const r = await askWebAI({ prompt: 'hello', provider: 'duckai', dryRun: true });
  assert.equal(r.status, 'success');
  assert.equal(r.provider, 'duckai');
  assert.equal(r.answer, null);
  assert.equal(r.meta.dryRun, true);
});

test('provider list reflects config enable flags', () => {
  const cfg = loadConfig({ providers: { gemini: { enabled: false } } });
  const ids = listEnabledProviders(cfg).map((p) => p.id);
  assert.ok(!ids.includes('gemini'));
  assert.ok(ids.includes('duckai'));
});
