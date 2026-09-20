/**
 * Task Router.
 *
 * Decides whether a task should be delegated to a free web AI or kept by the
 * main model. This is a *deterministic heuristic*, not an AI call: asking a
 * model to decide whether to save money would itself cost money and context,
 * which defeats the purpose.
 *
 * The router reads the task text, scores it against two signal sets, and emits
 * a decision plus the reasons behind it. It never calls the network.
 *
 * Honest limits: this is pattern matching. It is right most of the time on
 * clearly-shaped tasks and uncertain on vague ones, which is why it reports a
 * confidence level and always explains itself. `route()` is advisory -- the
 * caller is free to ignore it.
 */

/** Task shapes that are usually safe and worthwhile to delegate. */
const DELEGATE_SIGNALS = [
  { id: 'summarise', weight: 4, type: 'summarise', patterns: [/summar/i, /tl;?dr/i, /总结/, /摘要/, /概括/, /提炼/] },
  { id: 'translate', weight: 4, type: 'translate', patterns: [/translat/i, /翻译/, /译成/, /locali[sz]e/i] },
  { id: 'classify', weight: 4, type: 'classify', patterns: [/classif/i, /categori[sz]e/i, /label(?!\s*$)/i, /tag\b/i, /分类/, /归类/, /打标签/, /判断类别/] },
  { id: 'extract', weight: 4, type: 'extract', patterns: [/extract/i, /parse\b/i, /turn .* into (json|csv|a table)/i, /convert .* to (json|csv)/i, /提取/, /抽取/, /转成\s*(json|csv)/i, /转换成\s*(json|csv)/i] },
  { id: 'rewrite', weight: 4, type: 'rewrite', patterns: [/\bre-?word\b/i, /rephrase/i, /rewrite/i, /revise/i, /proofread/i, /polish\b/i, /fix the grammar/i, /make .* (sound|read) (more )?\w+/i, /tone\b/i, /改写/, /润色/, /校对/, /换个说法/, /重写/, /改得.*(正式|委婉|简洁)/, /语气/] },
  { id: 'format', weight: 3, type: 'format', patterns: [/reformat/i, /format (this|the)/i, /clean up (this|the) text/i, /排版/, /格式化/, /整理成/] },
  { id: 'shorten', weight: 3, type: 'shorten', patterns: [/shorten/i, /make .* (shorter|concise)/i, /缩短/, /精简/, /压缩/] },
  { id: 'simple_qa', weight: 1, type: 'qa', patterns: [/^(what|who|when|where) (is|are|was|were)\b/i, /^explain (what|the concept)/i, /什么是/, /解释一下.*概念/] },

  // Payload shape hints: delegation saves the most when a big blob rides along.
  { id: 'inline_payload', weight: 2, type: null, patterns: [/(the )?(following|below|attached) (text|passage|paragraph|article|document)/i, /^以下是/, /下面这段/, /如下所示/] },
  { id: 'batch_shape', weight: 3, type: null, patterns: [/\bfor each\b/i, /\beach (line|item|row|entry)\b/i, /\bbatch\b/i, /\b\d{2,} (items|rows|keywords|lines|entries)\b/i, /每(一)?(行|条|个)/, /批量/] },
];

/** Signals that mean the main model must keep the task. */
const KEEP_SIGNALS = [
  { id: 'repo_context', weight: -6, reason: 'needs repository context the web AI cannot see', patterns: [/\b(repo|repository|codebase|our project|this project|the project)\b/i, /\bthis (file|function|class|module|component)\b/i, /仓库/, /代码库/, /本项目/, /这个(文件|函数|类|模块)/, /项目架构/] },
  { id: 'file_editing', weight: -6, reason: 'involves editing files, which the web AI cannot do', patterns: [/\b(edit|modify|refactor|rename|delete|create|write|rewrite|reword|patch|update)\b.*\b(file|code|function|class|module|component|test|script)s?\b/i, /修改(代码|文件|函数|项目)/, /重构/, /改代码/, /写代码/] },
  { id: 'tool_use', weight: -6, reason: 'needs tools (shell, tests, git) the web AI does not have', patterns: [/\b(run|execute|install|deploy|commit|push|build|compile|test|debug)\b/i, /\bgit\b/i, /运行/, /执行/, /安装/, /部署/, /编译/, /调试/, /提交代码/] },
  { id: 'multistep', weight: -5, reason: 'multi-step work where steps depend on each other', patterns: [/\bthen\b/i, /\bafter that\b/i, /\bfirst\b.*\bsecond\b/i, /\bstep[- ]by[- ]step\b/i, /^\s*\d+[.)]\s/m, /然后/, /接着/, /第一步/, /分步骤/] },
  { id: 'current_facts', weight: -5, reason: 'needs current facts the web AI may hallucinate', patterns: [/\b(latest|today|tonight|right now|current price|stock price|news)\b/i, /\b20\d\d\b.*\b(release|version|update)\b/i, /最新/, /今天的?新闻/, /实时/, /股价/, /当前价格/] },
  { id: 'engineering_judgement', weight: -5, reason: 'needs engineering judgement and accountability', patterns: [/\b(architect|design a system|system design|debug|diagnose|root cause|security review|threat model)\b/i, /架构设计/, /设计系统/, /排查/, /根因/, /安全审计/] },
  { id: 'long_reasoning', weight: -3, reason: 'looks like open-ended reasoning rather than a text transformation', patterns: [/\b(prove|derive|reason about|analy[sz]e why|trade-?offs?)\b/i, /论证/, /推导/, /权衡/] },
];

/** Crude language detector -- only used to pick pattern sets, never to decide. */
function looksChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function scorePatterns(text, signals) {
  const hits = [];
  for (const sig of signals) {
    for (const re of sig.patterns) {
      const m = text.match(re);
      if (m) {
        hits.push({ id: sig.id, weight: sig.weight, type: sig.type ?? null, reason: sig.reason ?? null, match: m[0].slice(0, 40) });
        break; // one hit per signal is enough
      }
    }
  }
  return hits;
}

/**
 * Classify one task.
 *
 * @param {string} task  free-form description of the work
 * @param {object} [opts]
 * @param {number} [opts.threshold]        score at or above which we delegate
 * @param {number} [opts.payloadChars]     size of the text the task carries
 * @returns {{
 *   decision: 'delegate'|'keep'|'unsure',
 *   confidence: 'high'|'medium'|'low',
 *   score: number,
 *   taskType: string,
 *   reasons: string[],
 *   signals: object[]
 * }}
 */
export function classifyTask(task, opts = {}) {
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 4;
  const text = String(task || '').trim();
  const payloadChars = Number(opts.payloadChars) || 0;

  if (!text) {
    return { decision: 'unsure', confidence: 'low', score: 0, taskType: 'unknown', reasons: ['empty task'], signals: [] };
  }

  const delegable = scorePatterns(text, DELEGATE_SIGNALS);
  const blocking = scorePatterns(text, KEEP_SIGNALS);

  let score = 0;
  for (const h of delegable) score += h.weight;
  for (const h of blocking) score += h.weight;

  // A large payload makes delegation strictly more valuable, because keeping it
  // in the main context is what actually burns tokens.
  if (payloadChars > 8000) score += 3;
  else if (payloadChars > 1500) score += 2;
  else if (payloadChars > 400) score += 1;

  // Any hard blocker means the main model keeps it, regardless of text-shape.
  const hasBlocker = blocking.some((h) => h.weight <= -5);

  let decision;
  if (hasBlocker) decision = 'keep';
  else if (score >= threshold) decision = 'delegate';
  else if (score >= threshold - 2) decision = 'unsure';
  else decision = 'keep';

  // Confidence from the distance to the threshold and the presence of blockers.
  const distance = Math.abs(score - threshold);
  let confidence;
  if (hasBlocker || distance >= 4) confidence = 'high';
  else if (distance >= 2) confidence = 'medium';
  else confidence = 'low';

  const taskType = delegable.find((h) => h.type)?.type || (hasBlocker ? 'engineering' : 'unknown');

  const reasons = [];
  for (const h of delegable) reasons.push(`+ ${h.id} (\"${h.match}\")`);
  for (const h of blocking) reasons.push(`- ${h.id}: ${h.reason} (\"${h.match}\")`);
  if (payloadChars > 400) reasons.push(`+ payload is ${payloadChars} chars, so delegating saves that much context`);

  return { decision, confidence, score, taskType, reasons, signals: [...delegable, ...blocking] };
}

/**
 * Route a task and attach a suggested action.
 *
 * @param {string} task
 * @param {object} [opts]
 * @param {string} [opts.defaultProvider]  provider to suggest when delegating
 * @param {object} [opts.providerByType]   e.g. { translate: 'qwen' }
 * @param {string} [opts.providerEnabled]  provider currently available
 */
export function routeTask(task, opts = {}) {
  const verdict = classifyTask(task, opts);

  const providerByType = opts.providerByType || {};
  let suggestedProvider = null;
  if (verdict.decision !== 'keep') {
    suggestedProvider = providerByType[verdict.taskType] || opts.defaultProvider || 'duckai';
  }

  const advice = {
    delegate: 'Send this to a web AI and use only the returned text.',
    keep: 'Keep this on the main model.',
    unsure: 'Either way is defensible. Delegate if the input text is large; keep it if correctness matters.',
  }[verdict.decision];

  return {
    task,
    decision: verdict.decision,
    confidence: verdict.confidence,
    score: verdict.score,
    taskType: verdict.taskType,
    suggestedProvider,
    advice,
    reasons: verdict.reasons,
  };
}

/**
 * Route a list of tasks in one pass, and report the total payload that would
 * stay out of the main context if the delegable ones were handed off.
 *
 * @param {Array<string|{task:string,payloadChars?:number}>} tasks
 */
export function routeTasks(tasks, opts = {}) {
  const results = (tasks || []).map((t) => {
    const task = typeof t === 'string' ? t : t?.task || '';
    const payloadChars = typeof t === 'string' ? 0 : Number(t?.payloadChars) || 0;
    return { ...routeTask(task, { ...opts, payloadChars }), payloadChars };
  });

  const delegable = results.filter((r) => r.decision === 'delegate');
  const kept = results.filter((r) => r.decision !== 'delegate');

  return {
    total: results.length,
    delegate: delegable.length,
    keep: kept.length,
    delegatedPayloadChars: delegable.reduce((n, r) => n + r.payloadChars, 0),
    results,
  };
}
