/**
 * WebAIProvider base class.
 *
 * A provider knows how to talk to ONE web AI chat site. The main agent never
 * sees any of this — it only calls askWebAI(prompt, provider).
 *
 * Subclasses implement the four site-specific steps:
 *   isLoggedIn(page)   -> detect login wall / signed-out state
 *   findInput(page)    -> locate the prompt composer
 *   submit(page, text) -> type the prompt and press send
 *   extractAnswer(page, baseline) -> read the finished answer text
 *
 * Everything else (timeouts, stability polling, result shape, logging) lives
 * here so providers stay small and selector changes stay localised.
 */

import { ErrorCodes, WebAIError, toWebAIError } from './errors.js';
import { log, stopwatch } from './logger.js';

export class WebAIProvider {
  /**
   * @param {string} id  provider key from config (e.g. 'gemini')
   * @param {object} settings provider config block
   * @param {object} config   full resolved config
   */
  constructor(id, settings, config) {
    this.id = id;
    this.settings = settings;
    this.config = config;
    this.url = settings.url;
    /** Selector lists live on the subclass; see providers/*.js */
    this.selectors = this.constructor.selectors || {};
  }

  /** Human readable name for logs / results. */
  get displayName() {
    return this.settings.displayName || this.id;
  }

  // ---- to be implemented by subclasses -----------------------------------

  /** @returns {Promise<boolean>} true when the site looks usable (signed in). */
  async isLoggedIn() {
    throw new WebAIError(`${this.id}: isLoggedIn() not implemented`, ErrorCodes.INTERNAL);
  }

  /** @returns {Promise<import('playwright-core').Locator|null>} */
  async findInput() {
    throw new WebAIError(`${this.id}: findInput() not implemented`, ErrorCodes.INTERNAL);
  }

  /** Type the prompt and trigger send. */
  async submit() {
    throw new WebAIError(`${this.id}: submit() not implemented`, ErrorCodes.INTERNAL);
  }

  /**
   * @param {object} baseline snapshot taken before submitting
   * @returns {Promise<string>} final answer text
   */
  async extractAnswer() {
    throw new WebAIError(`${this.id}: extractAnswer() not implemented`, ErrorCodes.INTERNAL);
  }

  // ---- shared helpers ----------------------------------------------------

  /**
   * Return the first selector in `list` that matches, waiting a little for
   * each. Sites love shuffling DOM around, so every provider keeps 3-6
   * fallbacks and we take whichever appears first.
   *
   * @param {import('playwright-core').Page} page
   * @param {string[]} list
   * @param {{timeout?:number, requireVisible?:boolean, scope?:import('playwright-core').Locator}} [opts]
   */
  async firstMatch(page, list, opts = {}) {
    const { timeout = 8000, requireVisible = true, scope = null } = opts;
    for (const selector of list) {
      try {
        const locator = scope ? scope.locator(selector).first() : page.locator(selector).first();
        await locator.waitFor({ state: requireVisible ? 'visible' : 'attached', timeout });
        return locator;
      } catch {
        continue;
      }
    }
    return null;
  }

  /** Count how many answer blocks exist right now (used as a baseline). */
  async countAnswers(page) {
    const selector = this.selectors.ANSWER_COUNT || this.selectors.ANSWER;
    if (!selector) return 0;
    try {
      return await page.locator(selector).count();
    } catch {
      return 0;
    }
  }

  /** Is the "stop generating" control currently visible? */
  async isGenerating(page) {
    const list = this.selectors.STOP_BUTTON || [];
    for (const selector of list) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 250 })) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  /** Text of the newest answer block, or '' when unreadable. */
  async readLatestAnswer(page) {
    const list = this.selectors.ANSWER || [];
    for (const selector of list) {
      try {
        const all = page.locator(selector);
        const n = await all.count();
        if (n === 0) continue;
        const text = await all.nth(n - 1).innerText({ timeout: 2000 });
        if (text && text.trim()) return text.trim();
      } catch {
        continue;
      }
    }
    return '';
  }

  /**
   * Detect a human-verification challenge (CAPTCHA).
   *
   * We NEVER attempt to solve or bypass these. Detection exists only so the
   * call fails fast with a clear, actionable message: "open the browser window
   * and complete the challenge yourself, then retry".
   */
  async detectCaptcha(page) {
    const list = this.selectors.CAPTCHA || [];
    for (const selector of list) {
      try {
        if (await page.locator(selector).first().isVisible({ timeout: 500 })) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * Detect a network-level block / rate-limit interstitial.
   *
   * Google serves https://www.google.com/sorry/... when it decides a network
   * looks abusive. We never try to evade this: the call fails fast with an
   * actionable message so the caller can switch provider or wait.
   */
  async detectAccessBlocked(page) {
    let url = '';
    try {
      url = page.url();
    } catch {
      return false;
    }
    const urlSignals = [/google\.com\/sorry/i, /\/sorry\//i, /\/cdn-cgi\/challenge/i, /captcha-delivery\.com/i];
    if (urlSignals.some((r) => r.test(url))) return true;

    const textSignals = this.selectors.BLOCK_WALL_TEXT || [
      'text=检测到您的计算机网络中存在异常流量',
      'text=unusual traffic from your computer network',
      'text=unusual traffic',
      'text=Too Many Requests',
    ];
    const bodyText = await page
      .evaluate(() => (document.body?.innerText || '').slice(0, 4000))
      .catch(() => '');
    if (/异常流量|unusual traffic from your computer network/i.test(bodyText)) return true;

    for (const selector of textSignals) {
      try {
        if (await page.locator(selector).first().isVisible({ timeout: 300 })) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * Detect a login wall generically. Providers may override with extra logic.
   * We deliberately do NOT try to defeat the wall - we just report it.
   */
  async detectLoginWall(page) {
    // URL patterns are the most reliable signal across SPA rebuilds.
    try {
      const url = page.url();
      const patterns = this.selectors.LOGIN_URL || [];
      for (const p of patterns) {
        if (typeof p === 'string' ? url.includes(p) : p.test(url)) return true;
      }
    } catch {
      /* ignore */
    }

    const list = this.selectors.LOGIN_WALL || [];
    for (const selector of list) {
      try {
        if (await page.locator(selector).first().isVisible({ timeout: 400 })) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  /**
   * The full ask flow shared by every provider.
   *
   * @param {import('playwright-core').Page} page
   * @param {string} prompt
   * @param {{timeoutMs:number, stableMs:number, pollMs:number, newChat:boolean, signal:AbortSignal}} opts
   * @returns {Promise<{answer:string, url:string, elapsedMs:number}>}
   */
  async ask(page, prompt, opts) {
    const { timeoutMs, stableMs, pollMs } = opts;
    const sw = stopwatch();
    const deadline = Date.now() + timeoutMs;

    if (!(await this.isLoggedIn(page))) {
      throw new WebAIError(
        `${this.displayName} is not signed in. Open the browser window and log in once; the session is stored in the dedicated Chrome profile and reused afterwards.`,
        ErrorCodes.LOGIN_REQUIRED,
        { provider: this.id, url: this.url, loginUrl: this.url },
      );
    }

    if (await this.detectAccessBlocked(page)) {
      throw new WebAIError(
        `${this.displayName} is refusing requests from this network right now (rate limit / abuse filter). ` +
          'This project never bypasses such blocks. Wait and retry later, or use a different provider (e.g. duckai, qwen).',
        ErrorCodes.ACCESS_BLOCKED,
        { provider: this.id, url: page.url(), suggestion: 'Retry later or switch provider' },
      );
    }

    if (await this.detectCaptcha(page)) {
      throw new WebAIError(
        `${this.displayName} is showing a human-verification challenge. This project never bypasses CAPTCHAs. ` +
          'Open the visible browser window, complete the challenge yourself, then run the same command again.',
        ErrorCodes.CAPTCHA_REQUIRED,
        { provider: this.id, url: page.url(), manualAction: 'Solve the CAPTCHA in the open Chrome window' },
      );
    }

    const input = await this.findInput(page);
    if (!input) {
      throw new WebAIError(
        `Could not find the prompt input on ${this.displayName}. The page layout may have changed.`,
        ErrorCodes.SELECTORS_STALE,
        { provider: this.id, url: page.url() },
      );
    }

    const baseline = await this.captureBaseline(page);
    log.debug('Submitting prompt', { provider: this.id, baseline, chars: prompt.length });

    try {
      await this.submit(page, prompt, input);
    } catch (err) {
      throw toWebAIError(err, ErrorCodes.SUBMIT_FAILED);
    }

    const answer = await this.waitForAnswer(page, { deadline, stableMs, pollMs, baseline });
    const text = this.postProcess(answer);

    if (!text) {
      throw new WebAIError(`Answer extracted from ${this.displayName} was empty`, ErrorCodes.EXTRACTION_FAILED, { provider: this.id });
    }

    return { answer: text, url: page.url(), elapsedMs: sw.elapsed() };
  }

  /** Hook for subclasses to strip UI chrome / citation noise. */
  postProcess(text) {
    return (text || '').trim();
  }

  /** Snapshot state before submitting so we can detect the *new* answer. */
  async captureBaseline(page) {
    return { answerCount: await this.countAnswers(page) };
  }

  /**
   * Poll until a new answer appears and its text stops changing.
   * This is the single most failure-prone part of web UI automation, so the
   * logic is intentionally conservative:
   *   1. wait for a new answer block (count grows) OR the last block's text to change
   *   2. require `stableMs` of no change AND no stop/streaming control visible
   */
  async waitForAnswer(page, { deadline, stableMs, pollMs, baseline }) {
    const waitStart = Date.now();
    let lastText = '';
    let stableSince = 0;
    let sawNew = false;
    let polls = 0;

    while (Date.now() < deadline) {
      if (polls++ === 0) log.info('Waiting for answer...', { provider: this.id });
      await new Promise((r) => setTimeout(r, pollMs));

      const count = await this.countAnswers(page);
      const generating = await this.isGenerating(page);
      const text = await this.readLatestAnswer(page);

      const countGrew = count > (baseline?.answerCount ?? 0);
      if (countGrew || (text && text !== lastText)) sawNew = true;
      if (!sawNew) {
        if (polls % 20 === 0) log.info('Still waiting for the answer to start...', { provider: this.id, waitedSeconds: Math.round((Date.now() - waitStart) / 1000) });
        continue;
      }

      if (text && text === lastText && !generating) {
        if (stableSince === 0) stableSince = Date.now();
        if (Date.now() - stableSince >= stableMs) {
          log.info('Answer complete', { provider: this.id, chars: text.length });
          return text;
        }
      } else {
        stableSince = 0;
      }
      lastText = text;
    }

    if (lastText) {
      log.warn('Answer arrived but never fully stabilised before the deadline; returning last snapshot', {
        provider: this.id,
        chars: lastText.length,
      });
      return lastText;
    }
    throw new WebAIError(
      `${this.displayName} did not produce an answer before the deadline (${Math.round((Date.now() - waitStart) / 1000)}s elapsed). ` +
        'See the artifacts folder for a screenshot of the page state at the time of failure.',
      ErrorCodes.TIMEOUT,
      { provider: this.id, url: page.url(), waitedSeconds: Math.round((Date.now() - waitStart) / 1000) },
    );
  }

  /** Type text into a contenteditable/textarea and submit. */
  async submit(page, prompt, input) {
    await input.click({ timeout: 10000 });
    await this.setInputText(page, input, prompt);

    const button = await this.findSendButton(page);
    if (button) {
      await button.click({ timeout: 10000 });
      return;
    }
    log.debug('No send button matched; falling back to Enter key', { provider: this.id });
    await input.press('Enter');
  }

  /**
   * Robustly place text into an input.
   *
   * Sites use either a real <textarea> or a contenteditable rich editor.
   * For contenteditable, fill() often fails or leaves stale nodes, so we clear
   * then insert text through the keyboard path which fires the events the SPA
   * framework listens for.
   */
  async setInputText(page, input, prompt) {
    const tag = await input.evaluate((el) => el.tagName.toLowerCase()).catch(() => 'div');

    if (tag === 'textarea' || tag === 'input') {
      await input.fill(prompt, { timeout: 10000 });
      return;
    }

    // contenteditable path
    await input.click({ timeout: 10000 });
    await page.keyboard.press('Control+A').catch(() => {});
    await page.keyboard.press('Delete').catch(() => {});
    try {
      await input.fill(prompt, { timeout: 5000 });
      if (await this.inputHasText(input, prompt)) return;
    } catch {
      /* fall through to keyboard insertion */
    }
    await page.keyboard.insertText(prompt);
  }

  async inputHasText(input, expected) {
    try {
      const text = (await input.innerText()) || '';
      return text.trim().length >= Math.min(expected.trim().length, 1);
    } catch {
      return false;
    }
  }

  /** Subclasses declare SEND_BUTTON selector lists. */
  async findSendButton(page) {
    return this.firstMatch(page, this.selectors.SEND_BUTTON || [], { timeout: 4000 });
  }
}




