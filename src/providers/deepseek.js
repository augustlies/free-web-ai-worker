/**
 * DeepSeek web provider (chat.deepseek.com).
 *
 * DeepSeek serves an anonymous session, but long answers and the history
 * sidebar only work with a login. We therefore require a signed-in profile,
 * matching this project's "use the user's own access, never bypass" rule.
 */

import { WebAIProvider } from '../core/provider.js';

const SELECTORS = {
  INPUT: ['textarea#chat-input', 'textarea[placeholder]', 'div[contenteditable="true"]', 'textarea'],
  SEND_BUTTON: [
    'div[role="button"][aria-disabled="false"]:has(svg)',
    'button[aria-label*="发送"]',
    'button[aria-label*="Send"]',
  ],
  STOP_BUTTON: [
    'div[role="button"]:has-text("停止")',
    'button:has-text("Stop")',
    'button[aria-label*="Stop"]',
  ],
  ANSWER: [
    'div.ds-markdown',
    'div.markdown',
    '[class*="markdown"]',
    '.ds-message',
  ],
  ANSWER_COUNT: 'div.ds-markdown',
  CAPTCHA: ['iframe[src*="recaptcha"]', 'iframe[title*="recaptcha" i]', 'iframe[src*="challenges.cloudflare.com"]', 'text=verify you are human', 'text=确认您是真人'],
  LOGIN_URL: ['/sign_in', '/login', '/signin'],
  LOGIN_WALL: ['button:has-text("登录")', 'a:has-text("Log in")', 'div[class*="login"]'],
};

export class DeepSeekProvider extends WebAIProvider {
  static selectors = SELECTORS;

  async isLoggedIn(page) {
    if (await this.detectAccessBlocked(page)) return true;
    // A sign_in URL means we are definitely signed out.
    if (await this.detectLoginWall(page)) return false;
    const input = await this.firstMatch(page, SELECTORS.INPUT, { timeout: 8000 });
    return !!input;
  }

  async findInput(page) {
    return this.firstMatch(page, SELECTORS.INPUT, { timeout: 15000 });
  }

  postProcess(text) {
    // DeepSeek appends a "still generating" style footer; strip common chrome.
    return (text || '')
      .replace(/\s*(深度思考|DeepThink|联网搜索|Search)\s*$/g, '')
      .trim();
  }
}

export default DeepSeekProvider;


