/**
 * ChatGPT web provider (chatgpt.com).
 *
 * Selectors cross-checked against ToaruPen/Cavendish (ISC-licensed) which
 * maintains a selector baseline for the ChatGPT web UI:
 *   #prompt-textarea                 composer (contenteditable)
 *   .composer-submit-button-color    send button
 *   [data-testid="stop-button"]      streaming indicator
 *   [data-message-author-role="assistant"]  assistant turns
 */

import { WebAIProvider } from '../core/provider.js';

const SELECTORS = {
  INPUT: ['#prompt-textarea', 'div[contenteditable="true"]#prompt-textarea', 'div[contenteditable="true"][role="textbox"]'],
  SEND_BUTTON: [
    '.composer-submit-button-color',
    'button[data-testid="send-button"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
  ],
  STOP_BUTTON: ['[data-testid="stop-button"]', 'button[aria-label*="Stop"]'],
  ANSWER: [
    '[data-message-author-role="assistant"] .markdown',
    '[data-message-author-role="assistant"]',
    'div.markdown',
  ],
  ANSWER_COUNT: '[data-message-author-role="assistant"]',
  CAPTCHA: ['iframe[src*="recaptcha"]', 'iframe[title*="recaptcha" i]', 'iframe[src*="challenges.cloudflare.com"]', 'text=verify you are human', 'text=确认您是真人'],
  LOGIN_URL: ['/sign_in', '/signin', '/login', 'accounts.google.com/ServiceLogin'],
  LOGIN_WALL: [
    'button[data-testid="login-button"]',
    'a[href*="/auth/login"]',
    'button:has-text("Log in")',
    'button:has-text("登录")',
  ],
};

export class ChatGPTProvider extends WebAIProvider {
  static selectors = SELECTORS;

  async isLoggedIn(page) {
    const input = await this.firstMatch(page, SELECTORS.INPUT, { timeout: 8000 });
    if (input) return true;
    return !(await this.detectLoginWall(page));
  }

  async findInput(page) {
    return this.firstMatch(page, SELECTORS.INPUT, { timeout: 15000 });
  }
}

export default ChatGPTProvider;


