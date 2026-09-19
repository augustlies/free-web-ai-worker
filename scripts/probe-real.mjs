/**
 * Dev helper: real end-to-end probe with optional pre-click and consent handling.
 * Usage: node scripts/probe-real.mjs <url> "<prompt>" <inputSelector> [--headed] [--click="text"]
 */
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--'));
const prompt = argv.filter((a) => !a.startsWith('--'))[1];
const inputSelector = argv.filter((a) => !a.startsWith('--'))[2];
const headed = argv.includes('--headed');
const clickText = (argv.find((a) => a.startsWith('--click=')) || '').split('=')[1] || '继续';

const browser = await chromium.launch({ channel: 'chrome', headless: !headed });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

async function tryClickText(text) {
  const candidates = [
    `button:has-text("${text}")`,
    `[role="button"]:has-text("${text}")`,
    `a:has-text("${text}")`,
  ];
  for (const sel of candidates) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 1500 })) {
        await el.click({ timeout: 3000 });
        console.log('[consent] clicked:', sel);
        return true;
      }
    } catch { /* keep trying */ }
  }
  return false;
}

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(3500);
  await tryClickText(clickText);
  await page.waitForTimeout(2500);

  const input = page.locator(inputSelector).first();
  await input.waitFor({ state: 'visible', timeout: 25000 });
  await input.click();
  await page.waitForTimeout(400);
  await page.keyboard.insertText(prompt);
  await page.waitForTimeout(600);
  const typed = await input.evaluate((el) => el.value ?? el.innerText ?? '');
  console.log('[input] typed length:', String(typed).length, 'preview:', JSON.stringify(String(typed).slice(0, 60)));

  await page.keyboard.press('Enter');
  console.log('[send] Enter pressed, waiting...');

  let last = -1, stable = 0;
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(1000);
    const len = await page.evaluate(() => document.body.innerText.length);
    if (len === last) { stable++; if (stable >= 5) { console.log('[wait] content stable'); break; } }
    else { stable = 0; last = len; if (len !== last) console.log('[wait] body text len ->', len); }
  }
  await page.waitForTimeout(1500);

  const report = await page.evaluate(() => {
    const sels = [
      '[data-testid*="message"]','[class*="message"]','[class*="Message"]','[class*="markdown"]',
      '[class*="Markdown"]','[class*="prose"]','[class*="response"]','[class*="Response"]',
      '[class*="answer"]','[class*="Answer"]','[class*="chat"]','article','[class*="bot"]','[class*="ai"]'
    ];
    const found = {};
    for (const s of sels) {
      try {
        const els = Array.from(document.querySelectorAll(s)).filter((e) => (e.innerText || '').trim().length > 0).slice(0, 5);
        if (els.length) found[s] = els.map((e) => ({ cls: String(e.className).slice(0,120), testid: e.getAttribute('data-testid'), text: (e.innerText||'').slice(0,150) }));
      } catch {}
    }
    return { url: location.href, len: document.body.innerText.length, found, tail: document.body.innerText.slice(-1200) };
  });

  writeFileSync('.tmp/probe-real-out.json', JSON.stringify(report, null, 2));
  console.log('\n===== PAGE TAIL =====\n' + report.tail);
  console.log('\n===== MATCHED CONTAINERS =====');
  for (const [k, v] of Object.entries(report.found)) console.log(k, '=>', v.length, 'e.g.', JSON.stringify(v[0].text.slice(0,70)));
} catch (err) {
  console.error('FAILED:', err.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
