/**
 * Dev helper: send a real prompt and dump the answer-area DOM.
 * Usage: node scripts/probe-answer.mjs <url> "<prompt>" <inputSelector> [outfile]
 *
 * Used once to discover stable answer selectors; not part of the runtime path.
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const [, , url, prompt, inputSelector, out = 'answer-probe.json'] = process.argv;
if (!url || !prompt || !inputSelector) {
  console.error('usage: node scripts/probe-answer.mjs <url> "<prompt>" <inputSelector> [outfile]');
  process.exit(2);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  const beforeHtml = await page.evaluate(() => document.body.innerHTML.length);
  const input = page.locator(inputSelector).first();
  await input.waitFor({ state: 'visible', timeout: 20000 });
  await input.click();
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(300);
  // Try Enter to send (duck.ai sends on Enter)
  await page.keyboard.press('Enter');

  console.log('waiting for response...');
  let last = '';
  let stable = 0;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const t = await page.evaluate(() => document.body.innerText.length);
    if (t === last) { stable++; if (stable >= 4) break; } else { stable = 0; last = t; }
  }
  await page.waitForTimeout(2000);

  const report = await page.evaluate(() => {
    const candidateSelectors = [
      '[data-testid*="message"]', '[class*="message"]', '[class*="Message"]',
      '[class*="markdown"]', '[class*="Markdown"]', '[class*="prose"]',
      '[class*="response"]', '[class*="Response"]', '[class*="answer"]',
      'article', 'main div[role="article"]'
    ];
    const out = {};
    for (const sel of candidateSelectors) {
      try {
        const els = Array.from(document.querySelectorAll(sel)).slice(0, 6);
        if (!els.length) continue;
        out[sel] = els.map((el) => ({
          tag: el.tagName.toLowerCase(),
          cls: (typeof el.className === 'string' ? el.className : '').slice(0, 140),
          testid: el.getAttribute('data-testid'),
          text: (el.innerText || '').slice(0, 120),
        }));
      } catch {}
    }
    return { bodyLen: document.body.innerText.length, candidates: out, bodyText: document.body.innerText.slice(-1500) };
  });
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('bodyLen before/after:', beforeHtml, report.bodyLen);
  console.log('--- tail of page text ---');
  console.log(report.bodyText);
  console.log('--- candidate selectors found ---');
  console.log(Object.keys(report.candidates).join('\n'));
} catch (err) {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
