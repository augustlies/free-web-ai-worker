/**
 * Qwen Chat web provider (chat.qwen.ai).
 *
 * Qwen is accessible with a free account and is markedly faster than the
 * western chatbots from mainland China networks, making it a good default
 * fallback for this project's primary user.
 */

import { WebAIProvider } from '../core/provider.js';

const SELECTORS = {
  INPUT: [
    'textarea#chat-input',
    'textarea[placeholder]',
    'div[contenteditable="true"]',
    'textarea',
  ],
  SEND_BUTTON: [
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button#send-message-button',
    'button[type="submit"]',
  ],
  STOP_BUTTON: ['button[aria-label*="Stop"]', 'button:has-text("停止")'],
  ANSWER: ['div[class*="markdown"]', 'div[class*="response"]', 'div[class*="message"]'],
  ANSWER_COUNT: 'div[class*="markdown"]',
  CAPTCHA: ['iframe[src*="recaptcha"]', 'iframe[title*="recaptcha" i]', 'iframe[src*="challenges.cloudflare.com"]', 'text=verify you are human', 'text=确认您是真人'],
  LOGIN_WALL: ['button:has-text("登录")', 'a:has-text("Log in")'],
};

export class QwenProvider extends WebAIProvider {
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

export default QwenProvider;

