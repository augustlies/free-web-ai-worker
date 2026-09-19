/**
 * Browser engine: owns the persistent Chrome instance and CDP connection.
 *
 * Why a persistent profile + CDP instead of a fresh Playwright context?
 *   - The whole point of this skill is to reuse the user's *already working*
 *     web AI sessions. A fresh context has no cookies and would force a login
 *     on every run.
 *   - Playwright's own launch() would create an isolated automation profile.
 *     Instead we launch the real system Chrome with --remote-debugging-port
 *     and a dedicated user-data-dir, then attach over CDP. This mirrors the
 *     approach used by ToaruPen/Cavendish (ISC) and ljie-PI/web-chat (MIT).
 *
 * This module never attempts to bypass logins, CAPTCHAs or any platform
 * protection. If a login wall is detected the caller is asked to log in
 * manually, in the visible browser window.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { ErrorCodes, WebAIError } from './errors.js';
import { log, stopwatch } from './logger.js';

const CDP_STATE_FILE = 'cdp-endpoint.json';
const WINDOWS_CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const POSIX_CHROME_CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
];

export function findChromePath(config) {
  const explicit = config?.browser?.chromePath;
  if (explicit && existsSync(explicit)) return explicit;

  const candidates = process.platform === 'win32' ? WINDOWS_CHROME_CANDIDATES : POSIX_CHROME_CANDIDATES;
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Last resort: rely on PATH lookup by spawn (channel: 'chrome').
  return null;
}

async function fetchJson(url, timeoutMs = 2000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Is a CDP endpoint already answering on this port? */
export async function probeCdp(port) {
  const version = await fetchJson(`http://127.0.0.1:${port}/json/version`, 1500);
  return version || null;
}

async function waitForCdp(port, timeoutMs, onTick) {
  const sw = stopwatch();
  while (sw.elapsed() < timeoutMs) {
    const v = await probeCdp(port);
    if (v) return v;
    if (onTick) onTick(sw.elapsed());
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/**
 * Launch system Chrome detached with remote debugging enabled.
 * The window stays open after the CLI exits so the login session survives.
 */
export function launchChrome(config, url) {
  const chromePath = findChromePath(config);
  const profileDir = config.browser.profileDir;
  const port = config.browser.port;

  mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--restore-last-session=false',
  ];
  if (!config.browser.keepAlive) args.push('--no-startup-window');
  args.push(url);

  log.info('Launching Chrome with remote debugging', { chromePath: chromePath || 'chrome (PATH)', port, profileDir });

  const child = spawn(chromePath || 'chrome', args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child;
}

/** Persist the CDP endpoint so the next invocation can find it fast. */
function saveCdpState(config, version) {
  try {
    const file = join(config.browser.profileDir, CDP_STATE_FILE);
    writeFileSync(file, JSON.stringify({ port: config.browser.port, browser: version.Browser, savedAt: new Date().toISOString() }, null, 2));
  } catch (err) {
    log.debug('Could not persist CDP state', { error: err.message });
  }
}

function readCdpState(config) {
  try {
    const file = join(config.browser.profileDir, CDP_STATE_FILE);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Ensure Chrome is up with CDP, then attach Playwright over it.
 *
 * @param {object} config
 * @param {object} [opts]
 * @param {boolean} [opts.forceLaunch] launch Chrome even if CDP is alive
 * @param {string}  [opts.initialUrl]  page to open on a fresh launch
 * @returns {Promise<{browser, context, launched:boolean}>}
 */
export async function ensureBrowser(config, opts = {}) {
  const { port, startupTimeoutMs } = config.browser;
  const initialUrl = opts.initialUrl || 'about:blank';

  let detail = null;
  if (!opts.forceLaunch) {
    detail = await probeCdp(port);
    if (detail) log.info('Reusing running Chrome via CDP', { port, browser: detail.Browser });
  }

  let launched = false;
  if (!detail) {
    const saved = readCdpState(config);
    if (saved && saved.port === port) log.debug('Previous CDP session recorded but not answering; starting fresh');
    launchChrome(config, initialUrl);
    launched = true;
    detail = await waitForCdp(port, startupTimeoutMs, (elapsed) => {
      if (elapsed > 15000 && elapsed % 5000 < 600) {
        log.info('Still waiting for Chrome CDP endpoint (first launch on a new profile can take a while)...', { port });
      }
    });
    if (!detail) {
      throw new WebAIError(
        `Chrome did not expose a CDP endpoint on port ${port} within ${Math.round(startupTimeoutMs / 1000)}s. ` +
          'If Chrome is showing a first-run dialog, close it and retry, or set browser.chromePath in config/local.json.',
        ErrorCodes.BROWSER_UNAVAILABLE,
        { port, profileDir: config.browser.profileDir },
      );
    }
    saveCdpState(config, detail);
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) {
    throw new WebAIError('Connected to Chrome but found no browser context', ErrorCodes.BROWSER_UNAVAILABLE, { port });
  }

  log.debug('CDP connection established', { contexts: browser.contexts().length, pages: context.pages().length });
  return { browser, context, launched };
}

/**
 * Open a new tab, navigate to url, and wait for the SPA to settle.
 * Always creates a fresh tab so concurrent callers do not fight over one page.
 */
export async function openPage(context, url, { waitMs = 60000 } = {}) {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: waitMs });
  } catch (err) {
    // A slow SPA can still be usable; only hard network failures should abort.
    if (!/Timeout/i.test(err.message)) {
      await page.close().catch(() => {});
      throw err;
    }
    log.debug('navigation domcontentloaded timeout; continuing with current page state', { url });
  }
  // networkidle frequently never fires on chat apps (SSE/WebSocket); treat it as best-effort.
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  return page;
}

/** Close the attched browser connection only; the Chrome process keeps running. */
export async function detach(browser) {
  try {
    await browser?.close();
  } catch (err) {
    log.debug('Error while detaching from Chrome', { error: err.message });
  }
}
