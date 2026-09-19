/**
 * Grok web provider (grok.com).
 *
 * Grok is an X-account product; this provider uses whatever session the
 * dedicated Chrome profile already has. It never performs login itself.
 */

import { WebAIProvider } from '../core/provider.js';

const SELECTORS = {
  INPUT: [
    'textarea[aria-label]',
    'div[contenteditable="true"]',
    'textarea',
    'div[role="textbox"]',
  ],
  SEND_BUTTON: [
    'button[type="submit"]',
    'button[aria-label*="Submit"]',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
  ],
  STOP_BUTTON: ['button:has-text("Stop")', 'button[aria-label*="Stop"]'],
  ANSWER: ['div[class*="response"]', 'div[class*="markdown"]', 'div[class*="message"]'],
  ANSWER_COUNT: 'div[class*="response"]',
  CAPTCHA: ['iframe[src*="recaptcha"]', 'iframe[title*="recaptcha" i]', 'iframe[src*="challenges.cloudflare.com"]', 'text=verify you are human', 'text=确认您是真人'],
  LOGIN_WALL: ['button:has-text("Sign in")', 'button:has-text("登录")', 'a[href*="sign-in"]'],
};

export class GrokProvider extends WebAIProvider {
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

export default GrokProvider;

