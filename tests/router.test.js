/**
 * Task Router tests. Offline, no network.
 *
 * The two headline cases are taken verbatim from the project's original brief:
 * "classify 100 keywords" should delegate, "modify the Python project's core
 * code" should not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTask, routeTask, routeTasks } from '../src/core/router.js';

test('router: the brief’s delegable examples are delegated', () => {
  const delegates = [
    '把 100 个关键词简单分类',
    '总结一篇英文论文',
    '把几个文本转换成 JSON',
    'Summarise this article in 3 sentences',
    'Translate the following paragraph into English',
    'Rewrite this email to sound more formal',
    'Label each row as positive or negative',
  ];
  for (const task of delegates) {
    const r = routeTask(task);
    assert.equal(r.decision, 'delegate', `expected delegate for: ${task} (score ${r.score})`);
    assert.ok(r.suggestedProvider, `expected a suggested provider for: ${task}`);
  }
});

test('router: the brief’s keep example is kept', () => {
  const r = routeTask('修改 Python 项目核心代码');
  assert.equal(r.decision, 'keep');
  assert.equal(r.suggestedProvider, null);
});

test('router: repository and code work is never delegated', () => {
  const keeps = [
    '分析整个项目架构并修改代码',
    'Refactor the auth module in our codebase',
    'Run the test suite and fix whatever fails',
    'Debug why the deployment is failing',
    'Rewrite this file to use async/await',
  ];
  for (const task of keeps) {
    assert.equal(routeTask(task).decision, 'keep', `expected keep for: ${task}`);
  }
});

test('router: tasks needing current facts are kept', () => {
  for (const task of ['What is the latest price of Bitcoin right now', '今天的新闻有哪些']) {
    assert.equal(routeTask(task).decision, 'keep', `expected keep for: ${task}`);
  }
});

test('router: a large payload pushes an otherwise borderline task to delegate', () => {
  const small = classifyTask('Summarise this', { payloadChars: 100 });
  const large = classifyTask('Summarise this', { payloadChars: 20000 });
  assert.ok(large.score > small.score, 'a big payload must raise the score');
});

test('router: blockers override a delegable shape', () => {
  // "summarise" alone would delegate, but the repo-context blocker must win.
  const r = classifyTask('Summarise the codebase and refactor this module');
  assert.equal(r.decision, 'keep');
  assert.ok(r.reasons.some((x) => x.includes('repo_context') || x.includes('file_editing')));
});

test('router: empty input is unsure, not a crash', () => {
  const r = classifyTask('');
  assert.equal(r.decision, 'unsure');
  assert.equal(r.confidence, 'low');
  assert.equal(r.score, 0);
});

test('router: every verdict carries human-readable reasons', () => {
  const r = routeTask('Translate this document');
  assert.ok(Array.isArray(r.reasons));
  assert.ok(r.reasons.length > 0, 'must explain itself');
  assert.ok(typeof r.advice === 'string' && r.advice.length > 0);
});

test('router: provider can be mapped per task type', () => {
  const r = routeTask('Translate this into Chinese', {
    defaultProvider: 'duckai',
    providerByType: { translate: 'qwen' },
  });
  assert.equal(r.decision, 'delegate');
  assert.equal(r.taskType, 'translate');
  assert.equal(r.suggestedProvider, 'qwen');
});

test('router: batch routing reports the payload kept out of context', () => {
  const report = routeTasks([
    { task: 'Summarise this article', payloadChars: 5000 },
    { task: 'Refactor the auth module', payloadChars: 9000 },
    { task: 'Translate this paragraph', payloadChars: 3000 },
  ]);
  assert.equal(report.total, 3);
  assert.equal(report.delegate, 2);
  assert.equal(report.keep, 1);
  assert.equal(report.delegatedPayloadChars, 8000, 'only delegable payloads count');
});

test('router: classification is deterministic', () => {
  const task = '把 100 个关键词简单分类';
  const a = routeTask(task);
  const b = routeTask(task);
  assert.deepEqual(a, b);
});
