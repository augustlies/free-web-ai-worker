/**
 * Google Gemini web provider.
 *
 * Selectors verified against gemini.google.com on 2026-09-19 (zh-CN locale).
 * Gemini's composer is a Quill contenteditable; the send control only renders
 * once text is present, so submit() retries after typing.
 */

import { WebAIProvider } from '../core/provider.js';

const SELECTORS = {
  INPUT: [
    'div.ql-editor[contenteditable="true"]',
    'rich-textarea div[contenteditable="true"]',
    '.input-area-container div[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
  ],
  SEND_BUTTON: [
    'button.send-button',
    'button[aria-label="发送"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[data-testid="send-button"]',
    '.send-button-container button',
  ],
  STOP_BUTTON: [
    'button[aria-label="停止回答"]',
    'button[aria-label*="Stop"]',
    'button[aria-label*="停止"]',
    'mat-icon[data-mat-icon-name="stop_circle"]',
  ],
  ANSWER: [
    'message-content.model-response-text',
    'model-response message-content',
    'div.markdown.markdown-main-panel',
    '.response-container-content .markdown',
    'div.markdown',
  ],
  ANSWER_COUNT: 'message-content.model-response-text',
  CAPTCHA: ['iframe[src*="recaptcha"]', 'iframe[title*="recaptcha" i]', 'iframe[src*="challenges.cloudflare.com"]', 'text=verify you are human', 'text=确认您是真人'],
  LOGIN_URL: ['/sign_in', '/signin', '/login', 'accounts.google.com/ServiceLogin'],
  LOGIN_WALL: [
    'a[href*="accounts.google.com/ServiceLogin"]',
    'a[href*="accounts.google.com/signin"]',
  ],
};

export class GeminiProvider extends WebAIProvider {
  static selectors = SELECTORS;

  async isLoggedIn(page) {
    // A network block page is not a login problem; let ask() classify it.
    if (await this.detectAccessBlocked(page)) return true;
    // A visible "Sign in" link means we are on the marketing / signed-out shell.
    for (const sel of SELECTORS.LOGIN_WALL) {
      try {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 800 })) {
          // Signed-out users still get the marketing page with a Sign in link,
          // but the app shell also renders one briefly during hydration. Require
          // the composer to be absent before declaring a login wall.
          const editor = await page.locator(SELECTORS.INPUT[0]).first().isVisible({ timeout: 800 }).catch(() => false);
          if (!editor) return false;
          return false;
        }
      } catch {
        continue;
      }
    }
    // No sign-in link and a composer present => usable.
    const editor = await this.firstMatch(page, SELECTORS.INPUT, { timeout: 5000 });
    if (editor) return true;
    // Composer missing and a sign-in affordance present => login required.
    return !(await this.detectLoginWall(page));
  }

  async findInput(page) {
    return this.firstMatch(page, SELECTORS.INPUT, { timeout: 15000 });
  }

  async submit(page, prompt, input) {
    await input.click({ timeout: 10000 });
    await this.setInputText(page, input, prompt);
    // Gemini renders its send button only after the editor has content.
    await page.waitForTimeout(400);
    const button = await this.findSendButton(page);
    if (button) {
      await button.click({ timeout: 10000 });
      return;
    }
    await input.press('Enter');
  }

  postProcess(text) {
    return (text || '')
      .replace(/^\s*(显示思路|Show thinking)\s*/i, '')
      .replace(/\s*Gemini 可能会出错.*$/s, '')
      .trim();
  }
}

export default GeminiProvider;



