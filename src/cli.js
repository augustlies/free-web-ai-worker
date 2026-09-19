/**
 * CLI for the Agent Web AI skill.
 *
 *   ask-web-ai ask "<prompt>" [--provider qwen] [--json]
 *   ask-web-ai login [--provider deepseek]     open the browser for a one-time login
 *   ask-web-ai browser [--use edge|chrome]     show / switch which browser is driven
 *   ask-web-ai browser --stop                  close the driven browser window
 *   ask-web-ai providers                       list available providers
 *   ask-web-ai status                          browser / profile / provider status
 *
 * STDOUT carries only the JSON result (or human text when --text is given).
 * Diagnostics always go to STDERR.
 */

import { readFileSync } from 'node:fs';
import { loadConfig } from './core/config.js';
import { askWebAI } from './core/ask.js';
import { ErrorCodes, WebAIError } from './core/errors.js';
import { configureLogger, log } from './core/logger.js';
import {
  ensureBrowser,
  detach,
  openPage,
  probeCdp,
  resolveBrowser,
  detectInstalledBrowsers,
  profileDirFor,
  readCdpState,
  stopBrowser,
  writeLocalConfig,
} from './core/browser.js';
import { createProvider, knownProviderIds } from './providers/index.js';
import { usageReport, DEFAULT_THROTTLE } from './core/throttle.js';
import { cacheStats, cacheClear } from './core/cache.js';

const USAGE = `Agent Web AI — delegate simple text subtasks to a free web AI chat.

Usage:
  ask-web-ai ask [prompt] [options]        Ask a web AI and print the answer (JSON by default)
  ask-web-ai login [--provider <id>]       Open the browser so you can log in once
  ask-web-ai browser                       Show which browser is used and what is installed
  ask-web-ai browser --use <edge|chrome>   Switch which browser to drive
  ask-web-ai browser --stop                Close the browser this tool opened
  ask-web-ai providers                     List available web AIs
  ask-web-ai limits                        Show today's usage vs the anti-abuse caps
  ask-web-ai cache [--clear]               Show or clear cached answers
  ask-web-ai status                        Show browser / profile / provider status
  ask-web-ai --help                        Show this help

ask options:
  -p, --provider <id>    Web AI to use (default: duckai)
  -t, --timeout <sec>    Overall timeout in seconds (default: 120)
      --stable <sec>     How long the answer must stop changing (default: 3)
      --file <path>      Read the prompt from a file
      --stdin            Read the prompt from stdin
      --json             Force JSON output (default when stdout is piped)
      --text             Human-readable plain text output
      --log-level <lvl>  silent|error|warn|info|debug (default: info)
      --dry-run          Validate config/provider without opening a browser
      --no-throttle      Skip the local anti-abuse guard (not recommended)
      --no-cache         Ignore any cached answer and ask the site again

Examples:
  ask-web-ai ask "Summarise this in 3 bullet points: ..."
  ask-web-ai ask --file ./subtask.txt --provider deepseek
  ask-web-ai browser --use edge
  ask-web-ai login --provider deepseek

Notes:
  - The tool drives its own Edge/Chrome window with a separate profile.
    Your everyday browser windows are never touched.
  - DeepSeek / ChatGPT / Grok need a one-time login: run the login command.
  - Duck.ai and Qwen work with no account at all.
`;

function parseArgs(argv) {
  const out = { _: [], flags: {} };
  const alias = { '-p': '--provider', '-t': '--timeout', '-h': '--help' };
  for (let i = 0; i < argv.length; i++) {
    let token = argv[i];
    if (alias[token]) token = alias[token];
    if (token.startsWith('--')) {
      const eq = token.indexOf('=');
      if (eq > -1) {
        out.flags[token.slice(0, eq)] = token.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out.flags[token] = next;
        i++;
      } else {
        out.flags[token] = true;
      }
    } else {
      out._.push(token);
    }
  }
  return out;
}

function buildOptions(flags, positionalPrompt) {
  let prompt = positionalPrompt || flags['--prompt'] || '';
  if (flags['--file']) prompt = readFileSync(flags['--file'], 'utf8');
  if (flags['--stdin']) prompt = readFileSync(0, 'utf8');
  return {
    prompt,
    provider: typeof flags['--provider'] === 'string' ? flags['--provider'] : undefined,
    timeoutMs: flags['--timeout'] ? Number(flags['--timeout']) * 1000 : undefined,
    stableMs: flags['--stable'] ? Number(flags['--stable']) * 1000 : undefined,
    logLevel: typeof flags['--log-level'] === 'string' ? flags['--log-level'] : undefined,
    dryRun: !!flags['--dry-run'],
    noThrottle: !!flags['--no-throttle'],
    noCache: !!flags['--no-cache'],
  };
}

function printResult(result, { json }) {
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (result.status === 'success') {
    process.stdout.write(String(result.answer ?? '') + '\n');
  } else {
    process.stderr.write(`ERROR (${result.code || 'error'}): ${result.error}\n`);
    process.exitCode = 1;
  }
}

async function cmdAsk(args) {
  const json = args.flags['--text'] ? false : args.flags['--json'] || !process.stdout.isTTY;
  const opts = buildOptions(args.flags, args._[0]);
  if (!opts.prompt || !String(opts.prompt).trim()) {
    const help = new WebAIError('No prompt given. Pass it as an argument, --file <path>, or --stdin.', ErrorCodes.INVALID_INPUT);
    printResult(help.toResult(opts.provider ?? null), { json: true });
    process.exitCode = 2;
    return;
  }
  const result = await askWebAI(opts);
  printResult(result, { json });
  if (result.status !== 'success') process.exitCode = 1;
}

async function cmdLogin(args) {
  const cfg = loadConfig();
  configureLogger({ level: args.flags['--log-level'] || 'info' });
  const providerId = (typeof args.flags['--provider'] === 'string' ? args.flags['--provider'] : cfg.defaults.provider).toLowerCase();

  if (!knownProviderIds().includes(providerId)) {
    log.error(`Unknown provider "${providerId}"`, { known: knownProviderIds() });
    process.exitCode = 2;
    return;
  }

  const provider = createProvider(providerId, cfg);
  const { browser, context, browserInfo } = await ensureBrowser(cfg, { initialUrl: provider.url });
  const page = await openPage(context, provider.url, { waitMs: 60000 });

  log.info('');
  log.info(`A ${browserInfo.label} window is open on ${provider.displayName}.`);
  log.info('  1. Log in there normally (your password / QR code is handled by you, not by this tool).');
  log.info('  2. Make sure you can see the chat input box.');
  log.info('  3. Come back to this terminal and press Enter.');
  log.info('');

  const interactive = !!process.stdin.isTTY;
  if (interactive) {
    await new Promise((resolve) => {
      process.stdin.resume();
      process.stdin.once('data', resolve);
    });
  } else {
    // Started by an agent: there is no way for the user to press Enter here, so
    // keep the tab open and return. Closing it would defeat the whole command.
    log.info('The login page is open and will stay open. Log in there at your own pace.');
  }

  const url = page.url();
  if (interactive) await page.close().catch(() => {});
  await detach(browser);
  process.stdout.write(
    JSON.stringify(
      {
        status: 'success',
        provider: providerId,
        browser: browserInfo.id,
        action: 'login_window_opened',
        url,
        note: `Login state is stored in the dedicated ${browserInfo.label} profile and reused on future runs.`,
        profileDir: browserInfo.profileDir,
      },
      null,
      2,
    ) + '\n',
  );
}

async function cmdBrowser(args) {
  const cfg = loadConfig();
  configureLogger({ level: args.flags['--log-level'] || 'info' });
  const installed = detectInstalledBrowsers();
  const use = typeof args.flags['--use'] === 'string' ? args.flags['--use'].toLowerCase() : null;

  if (use) {
    if (!BROWSER_IDS.includes(use)) {
      log.error(`Unknown browser "${use}". Use one of: ${BROWSER_IDS.join(', ')}`);
      process.exitCode = 2;
      return;
    }
    if (!installed[use]) {
      log.error(`${BROWSER_LABELS[use] || use} does not appear to be installed on this machine.`, {
        hint: 'Set browser.chromePath in config/local.json to point at the executable.',
      });
      process.exitCode = 2;
      return;
    }
    const running = await probeCdp(cfg.browser.port);
    if (running) {
      const runningId = /edg/i.test(running.Browser || '') ? 'edge' : 'chrome';
      if (runningId !== use) {
        log.info(`Closing the ${BROWSER_LABELS[runningId] || runningId} window this tool opened so ${BROWSER_LABELS[use]} can take over...`);
        await stopBrowser(cfg, runningId);
      }
    }
    writeLocalConfig({ browser: { preferred: use } });
    process.stdout.write(
      JSON.stringify(
        {
          status: 'success',
          action: 'browser_switched',
          preferred: use,
          label: BROWSER_LABELS[use],
          path: installed[use].path,
          note: 'The next ask / login command will use this browser.',
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  const active = resolveBrowser(cfg);
  const detail = await probeCdp(cfg.browser.port);
  const runningId = detail ? (/edg/i.test(detail.Browser || '') ? 'edge' : 'chrome') : null;
  const report = {
    status: 'success',
    willUse: active ? { id: active.id, label: active.label, path: active.path, reason: active.source } : null,
    installed: Object.values(installed).map((b) => ({ id: b.id, label: b.label, path: b.path })),
    currentlyRunning: detail
      ? {
          id: runningId,
          label: BROWSER_LABELS[runningId] || runningId,
          version: detail.Browser,
          port: cfg.browser.port,
          matchesPreference: runningId === active?.id,
        }
      : null,
    profileDir: active ? profileDirFor(cfg, active.id) : null,
  };

  if (args.flags['--stop']) {
    const stopId = runningId || active?.id;
    const result = await stopBrowser(cfg, stopId);
    process.stdout.write(
      JSON.stringify(
        {
          status: 'success',
          action: 'browser_stopped',
          browser: stopId,
          stoppedProcesses: result.stopped,
          pids: result.pids,
          note: 'Only the window this tool opened was closed; your everyday browser was not touched.',
        },
        null,
        2,
      ) + '\n',
    );
    return;
  }

  if (!args.flags['--json'] && process.stdout.isTTY) {
    process.stdout.write(`Will use   : ${report.willUse ? report.willUse.label + ' (' + report.willUse.path + ')' : 'NONE FOUND'}\n`);
    process.stdout.write(`Reason     : ${report.willUse?.reason || '-'}\n`);
    process.stdout.write(`Installed  : ${report.installed.map((b) => b.label).join(', ') || 'none detected'}\n`);
    process.stdout.write(
      `Open now   : ${report.currentlyRunning ? report.currentlyRunning.label + ' ' + report.currentlyRunning.version : 'nothing on port ' + cfg.browser.port}\n`,
    );
    process.stdout.write(`Profile    : ${report.profileDir || '-'}\n`);
    process.stdout.write(`\nSwitch with: ask-web-ai browser --use edge\nClose with : ask-web-ai browser --stop\n`);
    return;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

async function cmdProviders(args) {
  const cfg = loadConfig();
  const list = knownProviderIds().map((id) => {
    const s = cfg.providers?.[id] || {};
    return {
      id,
      name: s.displayName || id,
      url: s.url,
      enabled: s.enabled !== false,
      requiresLogin: !!s.requiresLogin,
      isDefault: cfg.defaults.provider === id,
    };
  });
  if (!args.flags['--text'] && (args.flags['--json'] || !process.stdout.isTTY)) {
    process.stdout.write(JSON.stringify({ status: 'success', defaultProvider: cfg.defaults.provider, providers: list }, null, 2) + '\n');
  } else {
    for (const p of list) {
      process.stdout.write(
        `${p.enabled ? '●' : '○'} ${p.id.padEnd(10)} ${p.name.padEnd(14)} ${p.requiresLogin ? 'needs login' : 'no login   '}  ${p.url}\n`,
      );
    }
  }
}

async function cmdLimits(args) {
  const cfg = loadConfig();
  const installed = detectInstalledBrowsers();
  const active = resolveBrowser(cfg);
  if (!active) {
    process.stdout.write(JSON.stringify({ status: 'error', error: 'No browser found' }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }
  const profileDir = profileDirFor(cfg, active.id);
  const report = {
    status: 'success',
    browser: active.id,
    profileDir,
    rules: { ...DEFAULT_THROTTLE, ...(cfg.throttle || {}) },
    usage: usageReport(profileDir, knownProviderIds(), cfg.throttle),
  };
  if (!args.flags['--json'] && (args.flags['--text'] || process.stdout.isTTY)) {
    const r = report.rules;
    process.stdout.write(`Anti-abuse guard: ${r.enabled ? 'ON' : 'OFF'}\n`);
    process.stdout.write(`  minimum gap between calls : ${r.minIntervalSeconds}s\n`);
    process.stdout.write(`  longer rest every         : ${r.cooldownEvery} calls → ${r.cooldownSeconds}s\n`);
    process.stdout.write(`  daily cap per AI          : ${r.dailyQuota}\n`);
    process.stdout.write(`  pause after captcha/block : ${Math.round(r.breakerSeconds / 60)} min\n\n`);
    process.stdout.write('Provider     used today   remaining   last call      next call\n');
    for (const u of report.usage) {
      const last = u.secondsSinceLastCall === null ? 'never' : u.secondsSinceLastCall + 's ago';
      const next = u.blockedReason ? 'BLOCKED' : u.nextCallAllowedInSeconds > 0 ? `in ${u.nextCallAllowedInSeconds}s` : 'now';
      process.stdout.write(
        `${u.provider.padEnd(11)}  ${String(u.usedToday + '/' + u.dailyQuota).padEnd(11)}  ${String(u.remainingToday).padEnd(9)}  ${last.padEnd(13)}  ${next}\n`,
      );
      if (u.blockedReason) process.stdout.write(`             ↳ ${u.blockedReason}\n`);
    }
    return;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

async function cmdCache(args) {
  const cfg = loadConfig();
  const active = resolveBrowser(cfg);
  if (!active) {
    process.stdout.write(JSON.stringify({ status: 'error', error: 'No browser found' }, null, 2) + '\n');
    process.exitCode = 1;
    return;
  }
  const profileDir = profileDirFor(cfg, active.id);
  if (args.flags['--clear']) {
    const removed = cacheClear(profileDir);
    process.stdout.write(JSON.stringify({ status: 'success', action: 'cache_cleared', removed }, null, 2) + '\n');
    return;
  }
  const stats = cacheStats(profileDir);
  const report = { status: 'success', enabled: cfg.cache?.enabled !== false, ttlSeconds: cfg.cache?.ttlSeconds ?? 3600, ...stats };
  if (!args.flags['--json'] && (args.flags['--text'] || process.stdout.isTTY)) {
    process.stdout.write(`Cache: ${report.enabled ? 'ON' : 'OFF'} (kept for ${Math.round(report.ttlSeconds / 60)} min)\n`);
    process.stdout.write(`Entries: ${report.entries}\n`);
    process.stdout.write(`Location: ${report.dir}\n`);
    process.stdout.write(`Clear with: ask-web-ai cache --clear\n`);
    return;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

async function cmdStatus(args) {
  const cfg = loadConfig();
  const detail = await probeCdp(cfg.browser.port);
  const active = resolveBrowser(cfg);
  const installed = detectInstalledBrowsers();
  const provider = (cfg.providers || {})[cfg.defaults.provider] || {};

  const report = {
    status: 'success',
    browser: {
      willUse: active ? { id: active.id, label: active.label, path: active.path, reason: active.source } : null,
      installed: Object.keys(installed),
      openNow: detail ? { browser: detail.Browser, port: cfg.browser.port } : null,
      profileDir: active ? profileDirFor(cfg, active.id) : null,
    },
    defaultProvider: cfg.defaults.provider,
    defaultProviderName: provider.displayName || cfg.defaults.provider,
    timeoutMs: cfg.defaults.timeoutMs,
    enabledProviders: knownProviderIds().filter((id) => cfg.providers?.[id]?.enabled !== false),
  };

  if (!args.flags['--json'] && process.stdout.isTTY) {
    process.stdout.write(`Browser    : ${report.browser.willUse ? report.browser.willUse.label : 'NONE FOUND'}\n`);
    process.stdout.write(`Open now   : ${report.browser.openNow ? report.browser.openNow.browser : 'no'}\n`);
    process.stdout.write(`Profile    : ${report.browser.profileDir || '-'}\n`);
    process.stdout.write(`Default AI : ${report.defaultProviderName} (${report.defaultProvider})\n`);
    process.stdout.write(`Enabled    : ${report.enabledProviders.join(', ')}\n`);
    return;
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

const BROWSER_LABELS = { edge: 'Microsoft Edge', chrome: 'Google Chrome' };
const BROWSER_IDS = Object.keys(BROWSER_LABELS);

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.flags['--help'] || args.flags['-h'] || args._.length === 0) {
    process.stdout.write(USAGE);
    return;
  }
  const command = args._.shift();
  try {
    switch (command) {
      case 'ask':
        await cmdAsk(args);
        break;
      case 'login':
        await cmdLogin(args);
        break;
      case 'browser':
        await cmdBrowser(args);
        break;
      case 'providers':
        await cmdProviders(args);
        break;
      case 'limits':
        await cmdLimits(args);
        break;
      case 'cache':
        await cmdCache(args);
        break;
      case 'status':
        await cmdStatus(args);
        break;
      case 'version':
        process.stdout.write('agent-web-ai 0.2.0-mvp\n');
        break;
      default:
        process.stderr.write(`Unknown command "${command}"\n\n${USAGE}`);
        process.exitCode = 2;
    }
  } catch (err) {
    const e = err instanceof WebAIError ? err : new WebAIError(err?.message || String(err), ErrorCodes.INTERNAL);
    process.stdout.write(JSON.stringify(e.toResult(null), null, 2) + '\n');
    process.exitCode = 1;
  }
}






