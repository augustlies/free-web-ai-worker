/**
 * Browser engine: owns the persistent browser instance and the CDP connection.
 *
 * Why a persistent profile + CDP instead of a fresh Playwright context?
 *   - The point of this skill is to reuse the user's *already working* web AI
 *     sessions. A fresh context has no cookies and would force a login on
 *     every run.
 *   - Playwright's own launch() creates an isolated automation profile.
 *     Instead we launch the real system browser (Edge by default) with
 *     --remote-debugging-port and a dedicated user-data-dir, then attach over
 *     CDP. This mirrors the approach used by ToaruPen/Cavendish (ISC) and
 *     ljie-PI/web-chat (MIT).
 *
 * This module never attempts to bypass logins, CAPTCHAs or any platform
 * protection. If a login wall is detected the caller is asked to log in
 * manually, in the visible browser window.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { ErrorCodes, WebAIError } from './errors.js';
import { log, stopwatch } from './logger.js';
import { PROJECT_ROOT } from './config.js';

const CDP_STATE_FILE = 'cdp-endpoint.json';

/**
 * Known browser locations, in priority order per browser family.
 * `id` is what the user types in config / CLI.
 */
export const BROWSER_CANDIDATES = {
  edge: {
    label: 'Microsoft Edge',
    win32: [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    ],
    posix: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'],
  },
  chrome: {
    label: 'Google Chrome',
    win32: [
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
      'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    ],
    posix: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ],
  },
};

/** Which browsers are actually installed on this machine. */
export function detectInstalledBrowsers() {
  const platform = process.platform === 'win32' ? 'win32' : 'posix';
  const found = {};
  for (const [id, def] of Object.entries(BROWSER_CANDIDATES)) {
    const hit = def[platform].find((p) => existsSync(p));
    if (hit) found[id] = { id, label: def.label, path: hit };
  }
  return found;
}

/**
 * Resolve which browser to drive.
 * Priority: explicit config.browser.chromePath > config.browser.preferred > first installed.
 */
export function resolveBrowser(config) {
  const explicit = config?.browser?.chromePath;
  if (explicit && existsSync(explicit)) {
    const id = /msedge/i.test(explicit) ? 'edge' : 'chrome';
    return { id, label: BROWSER_CANDIDATES[id]?.label || id, path: explicit, source: 'config.browser.chromePath' };
  }

  const installed = detectInstalledBrowsers();
  const preferred = (config?.browser?.preferred || '').toLowerCase();

  if (preferred && installed[preferred]) {
    return { ...installed[preferred], source: `config.browser.preferred="${preferred}"` };
  }
  if (preferred && !installed[preferred]) {
    log.warn(`Preferred browser "${preferred}" is not installed; falling back to an available one`, {
      installed: Object.keys(installed),
    });
  }
  const first = Object.values(installed)[0];
  if (first) return { ...first, source: 'first installed browser' };
  return null;
}

/** Backwards-compatible helper used by the status command. */
export function findChromePath(config) {
  return resolveBrowser(config)?.path || null;
}

/**
 * Per-browser profile directory.
 * Keeping one profile per browser means switching browsers never mixes login
 * state, and the CDP state file can never point at the wrong browser.
 */
export function profileDirFor(config, browserId) {
  const base = config.browser.profileDir;
  return join(base, browserId || 'default');
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
  return (await fetchJson(`http://127.0.0.1:${port}/json/version`, 1500)) || null;
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

/** Best-effort UI language hint so sites render a predictable locale. */
function localeArgs() {
  const lang = process.env.LANG || process.env.LC_ALL || '';
  if (/zh/i.test(lang)) return ['--lang=zh-CN'];
  return [];
}

/**
 * Launch the resolved browser detached with remote debugging enabled.
 * The window stays open after the CLI exits so the login session survives.
 */
export function launchBrowser(config, browser, url, profileDir) {
  mkdirSync(profileDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${config.browser.port}`,
    `--user-data-dir=${profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate,msEdgeIdentityFeatures,msImplicitSignin',
    ...localeArgs(),
  ];
  if (!config.browser.keepAlive) args.push('--no-startup-window');
  args.push(url);

  log.info(`Launching ${browser.label}`, { path: browser.path, port: config.browser.port, profileDir });

  const child = spawn(browser.path, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();
  return child;
}

function saveCdpState(profileDir, config, browser, version, pid) {
  try {
    writeFileSync(
      join(profileDir, CDP_STATE_FILE),
      JSON.stringify(
        {
          port: config.browser.port,
          browserId: browser.id,
          browserLabel: browser.label,
          browserPath: browser.path,
          browserVersion: version?.Browser || null,
          pid: pid ?? null,
          savedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    log.debug('Could not persist CDP state', { error: err.message });
  }
}

/** Merge a patch into config/local.json so preferences survive restarts. */
export function writeLocalConfig(patch) {
  const file = join(PROJECT_ROOT, 'config', 'local.json');
  let existing = {};
  try {
    if (existsSync(file)) existing = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    existing = {};
  }
  const merge = (base, extra) => {
    const out = { ...base };
    for (const [k, v] of Object.entries(extra || {})) {
      out[k] = v && typeof v === 'object' && !Array.isArray(v) && base?.[k] && typeof base[k] === 'object' ? merge(base[k], v) : v;
    }
    return out;
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(merge(existing, patch), null, 2) + '\n');
  return file;
}

export function readCdpState(profileDir) {
  try {
    const file = join(profileDir, CDP_STATE_FILE);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Directory name fragments that can only appear in a browser *we* launched.
 * We match any of these so leftovers from an older layout are still cleaned up,
 * while the user's everyday browser (whose command line never mentions this
 * project) can never be matched.
 */
export function ownedProcessNeedles(config) {
  const configured = config?.browser?.profileDir;
  const needles = new Set();
  if (configured) {
    needles.add(configured);
    needles.add(dirname(configured));
  }
  needles.add(join(homedir(), '.agent-web-ai'));
  return [...needles].filter(Boolean);
}

/**
 * Find processes we launched, matched by the dedicated profile path.
 * Windows needs a CIM query; POSIX can inspect /proc via pgrep -f.
 */
export function findOwnedProcesses(config) {
  const needles = ownedProcessNeedles(config);
  const seen = new Map();
  try {
    if (process.platform === 'win32') {
      const conditions = needles.map((n) => `$_.CommandLine -like '*${n}*'`).join(' -or ');
      const ps = [
        `Get-CimInstance Win32_Process -Filter "Name='msedge.exe' OR Name='chrome.exe'"`,
        ` | Where-Object { ${conditions} }`,
        ` | Select-Object ProcessId, Name, CommandLine | ConvertTo-Json -Compress`,
      ].join('');
      const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        encoding: 'utf8',
        timeout: 15000,
        windowsHide: true,
      });
      if (out.status !== 0 || !out.stdout?.trim()) return [];
      const parsed = JSON.parse(out.stdout);
      for (const p of Array.isArray(parsed) ? parsed : [parsed]) {
        seen.set(p.ProcessId, { pid: p.ProcessId, name: p.Name, commandLine: p.CommandLine });
      }
    } else {
      for (const needle of needles) {
        const out = spawnSync('pgrep', ['-f', needle], { encoding: 'utf8', timeout: 10000 });
        if (!out.stdout?.trim()) continue;
        for (const pid of out.stdout.trim().split('\n')) {
          const n = Number(pid);
          if (Number.isFinite(n)) seen.set(n, { pid: n, name: 'browser' });
        }
      }
    }
  } catch (err) {
    log.debug('process lookup failed', { error: err.message });
  }
  return [...seen.values()];
}

/**
 * Stop the browser we launched for this profile.
 * Only processes whose command line contains our dedicated profile dir are
 * matched, so the user's own browser windows are never affected.
 *
 * @returns {Promise<{stopped:number, pids:number[]}>}
 */
export async function stopBrowser(config, browserId) {
  // Match processes by the tool's exclusive base directory (not the per-browser
  // subfolder) so leftovers from an older layout are still cleaned up.
  const procs = findOwnedProcesses(config);
  const pids = [];

  for (const p of procs) {
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { timeout: 10000, windowsHide: true });
      } else {
        process.kill(p.pid, 'SIGTERM');
      }
      pids.push(p.pid);
    } catch (err) {
      log.debug('could not stop process', { pid: p.pid, error: err.message });
    }
  }

  // The port should be free shortly; give it a moment to release.
  for (let i = 0; i < 10; i++) {
    if (!(await probeCdp(config.browser.port))) break;
    await new Promise((r) => setTimeout(r, 300));
  }

  try {
    rmSync(join(profileDirFor(config, browserId), CDP_STATE_FILE), { force: true });
  } catch {
    /* best effort */
  }
  log.info('Closed the browser window opened by this tool', { stoppedProcesses: pids.length, pids });

  return { stopped: pids.length, pids };
}

/**
 * Ensure the chosen browser is up with CDP, then attach Playwright over it.
 *
 * @param {object} config
 * @param {object} [opts]
 * @param {string}  [opts.initialUrl]  page to open on a fresh launch
 * @param {boolean} [opts.forceLaunch]  ignore an already-running CDP endpoint
 * @returns {Promise<{browser, context, launched:boolean, browserInfo:object}>}
 */
export async function ensureBrowser(config, opts = {}) {
  const { port, startupTimeoutMs } = config.browser;
  const initialUrl = opts.initialUrl || 'about:blank';

  const target = resolveBrowser(config);
  if (!target) {
    throw new WebAIError(
      'No supported browser found. Install Microsoft Edge or Google Chrome, or set browser.chromePath in config/local.json.',
      ErrorCodes.BROWSER_UNAVAILABLE,
      { lookedFor: Object.values(BROWSER_CANDIDATES).map((b) => b.win32?.[0]) },
    );
  }

  const profileDir = profileDirFor(config, target.id);
  let detail = null;
  let mismatch = null;

  if (!opts.forceLaunch) {
    detail = await probeCdp(port);
    if (detail) {
      // Is the thing on this port the browser we actually want?
      const running = /edg/i.test(detail.Browser || '') ? 'edge' : 'chrome';
      if (running !== target.id) {
        mismatch = { running, wanted: target.id, version: detail.Browser };
        log.info(
          `Switching browser: closing the ${BROWSER_CANDIDATES[running]?.label || running} window this tool opened earlier, ` +
            `then starting ${target.label}.`,
        );
        await stopBrowser(config, running);
        detail = await probeCdp(port);
      } else {
        log.info(`Reusing the open ${target.label} window`, { port, browser: detail.Browser });
      }
    }
  }

  let launched = false;
  if (!detail) {
    launchBrowser(config, target, initialUrl, profileDir);
    launched = true;
    detail = await waitForCdp(port, startupTimeoutMs, (elapsed) => {
      if (elapsed > 15000 && elapsed % 5000 < 600) {
        log.info(`Still waiting for ${target.label} to expose its debugging port (first launch on a new profile can take a while)...`, { port });
      }
    });
    if (!detail) {
      throw new WebAIError(
        `${target.label} did not expose a debugging port on ${port} within ${Math.round(startupTimeoutMs / 1000)}s. ` +
          'If the browser is showing a first-run dialog, close it and retry, or set browser.chromePath in config/local.json.',
        ErrorCodes.BROWSER_UNAVAILABLE,
        { port, profileDir, browser: target.id },
      );
    }
  }

  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  if (!context) {
    throw new WebAIError(`Connected to ${target.label} but found no browser context`, ErrorCodes.BROWSER_UNAVAILABLE, { port });
  }

  if (!launched) {
    // Record which browser actually owns this port so `browser` command can report it.
    saveCdpState(profileDir, config, target, detail, null);
  }

  log.debug('CDP connection established', {
    browser: target.id,
    contexts: browser.contexts().length,
    pages: context.pages().length,
  });

  return { browser, context, launched, browserInfo: { ...target, profileDir, running: detail.Browser, mismatch } };
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
    if (!/Timeout/i.test(err.message)) {
      await page.close().catch(() => {});
      throw err;
    }
    log.debug('navigation domcontentloaded timeout; continuing with current page state', { url });
  }
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  return page;
}

/** Close the attached browser connection only; the browser process keeps running. */
export async function detach(browser) {
  try {
    await browser?.close();
  } catch (err) {
    log.debug('Error while detaching from browser', { error: err.message });
  }
}




