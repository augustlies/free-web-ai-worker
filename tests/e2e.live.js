/**
 * Live end-to-end test — talks to a real web AI.
 *
 *   node tests/e2e.live.js [provider]
 *
 * Requires Chrome. The first run may need a manual login / verification
 * depending on the provider; see README.
 */

import { askWebAI } from '../src/core/ask.js';

const provider = process.argv[2] || 'duckai';
const prompt =
  process.argv[3] || '请用三句话解释什么是板块构造。只输出这三句话，不要标题，不要列表符号。';

console.log(`[e2e] provider=${provider}`);
console.log(`[e2e] prompt=${prompt}`);
console.log('[e2e] calling askWebAI…\n');

const started = Date.now();
const result = await askWebAI({ prompt, provider, timeoutMs: 180000, logLevel: 'info' });
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

if (result.status === 'success') {
  console.log('\n[e2e] PASS — answer received in ' + elapsed + 's');
  console.log('[e2e] provider:', result.provider);
  console.log('[e2e] answer:\n' + result.answer);
  console.log('[e2e] chars:', result.answer.length);
  if (!result.answer.trim()) {
    console.error('[e2e] FAIL — answer was empty');
    process.exit(1);
  }
} else {
  console.error(`\n[e2e] FAIL after ${elapsed}s`);
  console.error('[e2e] code   :', result.code);
  console.error('[e2e] error  :', result.error);
  if (result.meta?.artifacts) console.error('[e2e] artifacts:', result.meta.artifacts);
  process.exit(1);
}
