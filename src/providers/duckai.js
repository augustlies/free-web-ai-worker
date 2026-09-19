/**
 * Duck.ai provider (duck.ai) — zero-login provider, ideal for the first
 * end-to-end run and for machines where the user has not signed in anywhere.
 *
 * Verified live 2026-09-19 (Chrome 153, zh-CN locale):
 *
 *   composer      : textarea[placeholder]
 *   send button   : input empty -> aria-label "问"; after typing -> "发送"
 *                   (both matched by the SEND_BUTTON list below)
 *   answers       : Tailwind utility classes are stable across builds while
 *                   the styled-component hashes are regenerated, so we anchor
 *                   on `space-y-4 whitespace-normal`. The answer also survives
 *                   a generic text-diff fallback.
 *   headless      : Duck.ai serves a human-verification challenge to headless
 *                   Chrome. This provider is therefore intended to run in a
 *                   visible window (config.browser.headless = false). We detect
 *                   the challenge and ask the user to solve it manually; we
 *                   never attempt to bypass it.
 */

import { WebAIProvider } from '../core/provider.js';

const ANSWER_SELECTOR = 'div[class*="space-y-4"][class*="whitespace-normal"]';

const SELECTORS = {
  INPUT: [
    'textarea[placeholder]',
    'textarea[aria-label]',
    'textarea',
    'div[contenteditable="true"][role="textbox"]',
  ],
  SEND_BUTTON: [
    'button[aria-label="问"]',
    'button[aria-label="发送"]',
    'button[aria-label="Ask"]',
    'button[aria-label="Send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="Send"]',
    'button[type="submit"]',
  ],
  STOP_BUTTON: [
    'button[aria-label*="停止"]',
    'button[aria-label*="Stop"]',
  ],
  ANSWER: [ANSWER_SELECTOR],
  ANSWER_COUNT: ANSWER_SELECTOR,
  LOGIN_WALL: [],
  CONSENT: ['button:has-text("继续")', '[role="button"]:has-text("继续")', 'button:has-text("Continue")'],
  CAPTCHA: [
    'text=请完成以下挑战',
    'text=confirm this prompt is provided by a human',
    'text=选择所有包含',
    'iframe[src*="captcha"]',
    'iframe[title*="challenge"]',
  ],
};

export class DuckAIProvider extends WebAIProvider {
  static selectors = SELECTORS;

  /** Duck.ai needs no account. */
  async isLoggedIn() {
    return true;
  }

  /** Dismiss the one-time privacy notice if present. */
  async prepare(page) {
    for (const sel of SELECTORS.CONSENT) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 1200 })) {
          await el.click({ timeout: 3000 });
          await page.waitForTimeout(800);
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  async findInput(page) {
    await this.prepare(page);
    return this.firstMatch(page, SELECTORS.INPUT, { timeout: 15000 });
  }

  /**
   * Duck.ai's answer node is empty in the DOM until tokens arrive; an empty
   * container is fine here. Overriding readLatestAnswer keeps us from
   * mistaking the still-empty container for "no answer yet".
   */
  async readLatestAnswer(page) {
    try {
      const loc = page.locator(ANSWER_SELECTOR);
      const n = await loc.count();
      if (n === 0) return '';
      return ((await loc.nth(n - 1).innerText({ timeout: 2000 })) || '').trim();
    } catch {
      return '';
    }
  }

  postProcess(text) {
    // Strip trailing UI chrome that Duck.ai renders inside the answer column.
    return (text || '')
      .replace(/\s*第二意见\s*$/g, '')
      .replace(/\s*Second opinion\s*$/gi, '')
      .trim();
  }
}

export default DuckAIProvider;
