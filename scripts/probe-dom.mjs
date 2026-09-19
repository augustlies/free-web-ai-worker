/**
 * Dev helper: dump candidate selectors from a live chat page.
 * Usage: node scripts/probe-dom.mjs <url> [outfile]
 *
 * This is NOT part of the runtime path — it only exists so selectors in
 * src/providers/*.js can be verified against the real DOM instead of guessed.
 */

import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const out = process.argv[3] || 'probe-output.json';
if (!url) {
  console.error('usage: node scripts/probe-dom.mjs <url> [outfile]');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const report = await page.evaluate(() => {
    const describe = (el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: (el.className && typeof el.className === 'string' ? el.className : '').slice(0, 160) || null,
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      placeholder: el.getAttribute('placeholder') || el.getAttribute('data-placeholder'),
      testid: el.getAttribute('data-testid'),
      contenteditable: el.getAttribute('contenteditable'),
      visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      text: (el.innerText || '').slice(0, 80),
    });

    const collect = (selector, cap = 12) => {
      try {
        return Array.from(document.querySelectorAll(selector)).slice(0, cap).map(describe);
      } catch (e) {
        return [{ error: String(e) }];
      }
    };

    return {
      finalUrl: location.href,
      title: document.title,
      bodyTextSample: (document.body?.innerText || '').slice(0, 600),
      editors: collect('[contenteditable="true"], textarea, [role="textbox"]'),
      buttons: collect('button, [role="button"]', 40),
      forms: collect('form', 5),
      testids: collect('[data-testid]', 40).map((x) => x.testid).filter(Boolean),
      ariaLabels: collect('[aria-label]', 40).map((x) => x.aria).filter(Boolean),
    };
  });

  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('wrote', out);
  console.log('title:', report.title, '| url:', report.finalUrl);
  console.log('editors:');
  for (const e of report.editors) console.log('  ', JSON.stringify(e));
  console.log('aria labels:', report.ariaLabels.slice(0, 25).join(' | '));
} catch (err) {
  console.error('PROBE FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
