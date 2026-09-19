/**
 * CLI for the Agent Web AI skill.
 *
 *   ask-web-ai ask "<prompt>" [--provider gemini] [--timeout 120] [--json]
 *   ask-web-ai login [--provider gemini]      open the browser for manual login
 *   ask-web-ai status                         browser / profile / provider status
 *   ask-web-ai providers                      list configured providers
 *
 * STDOUT carries only the JSON result (or human text when --no-json).
 * Diagnostics always go to STDERR.
 */

import { readFileSync } from 'node:fs';
import { loadConfig } from './core/config.js';
import { askWebAI } from './core/ask.js';
import { ErrorCodes, WebAIError } from './core/errors.js';
import { configureLogger, log } from './core/logger.js';
import { ensureBrowser, detach, openPage, probeCdp, findChromePath } from './core/browser.js';
import { createProvider, knownProviderIds } from './providers/index.js';

const USAGE = `Agent Web AI — delegate simple text subtasks to a free web AI chat.

Usage:
  ask-web-ai ask [prompt] [options]      Ask a web AI and print the answer (JSON by default)
  ask-web-ai login [--provider <id>]     Open Chrome so you can log in once
  ask-web-ai providers                   List available providers
  ask-web-ai status                      Show browser / profile / provider status
  ask-web-ai --help                      Show this help

ask options:
  -p, --provider <id>    Web AI to use (default: config.defaults.provider)
  -t, --timeout <sec>    Overall timeout in seconds (default: 120)
      --stable <sec>     How long the answer must stop changing (default: 3)
      --file <path>      Read the prompt from a file
      --stdin            Read the prompt from stdin
      --json             Force JSON output (default when stdout is piped)
      --text             Human-readable plain text output
      --log-level <lvl>  silent|error|warn|info|debug (default: info)
      --dry-run          Validate config/provider without opening a browser

Examples:
  ask-web-ai ask "Summarise this in 3 bullet points: ..." -p gemini
  ask-web-ai ask --stdin --provider duckai < question.txt
  ask-web-ai login --provider gemini
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
  if (Array.isArray(prompt)) prompt = prompt.join(' ');
  return {
    prompt,
    provider: typeof flags['--provider'] === 'string' ? flags['--provider'] : undefined,
    timeoutMs: flags['--timeout'] ? Number(flags['--timeout']) * 1000 : undefined,
    stableMs: flags['--stable'] ? Number(flags['--stable']) * 1000 : undefined,
    logLevel: typeof flags['--log-level'] === 'string' ? flags['--log-level'] : undefined,
    dryRun: !!flags['--dry-run'],
  };
}

function printResult(result, { json }) {
  const text = typeof result.answer === 'string' ? result.answer : '';
  if (json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (result.status === 'success') {
    process.stdout.write(text + '\n');
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
  const providerId = (typeof args.flags['--provider'] === 'string' ? args.flags['--provider'] : cfg.defaults.provider || 'duckai').toLowerCase();
  if (!knownProviderIds().includes(providerId)) {
    log.error(`Unknown provider "${providerId}"`, { known: knownProviderIds() });
    process.exitCode = 2;
    return;
  }
  const provider = createProvider(providerId, cfg);
  log.info(`Opening ${provider.displayName} for manual login / verification`);
  const { browser, context } = await ensureBrowser(cfg, { initialUrl: provider.url });
  const page = await openPage(context, provider.url, { waitMs: 60000 });
  log.info('Chrome window is open. Complete any login or verification there, then press Enter here to close this tab.');
  await new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Non-interactive callers (agents) should not hang: give the user a grace period.
      log.info('Non-interactive stdin detected; leaving the tab open and returning immediately.');
      resolve();
      return;
    }
    process.stdin.resume();
    process.stdin.once('data', resolve);
  });
  const url = page.url();
  await page.close().catch(() => {});
  await detach(browser);
  process.stdout.write(JSON.stringify({ status: 'success', provider: providerId, action: 'login_window_opened', url, note: 'Chrome stays open with the dedicated profile; sessions persist.' }, null, 2) + '\n');
}

async function cmdProviders(args) {
  const cfg = loadConfig();
  const list = knownProviderIds().map((id) => {
    const s = cfg.providers?.[id] || {};
    return { id, name: s.displayName || id, url: s.url, enabled: s.enabled !== false, requiresLogin: !!s.requiresLogin, isDefault: (cfg.defaults.provider || 'duckai') === id };
  });
  const json = !args.flags['--text'];
  if (json) process.stdout.write(JSON.stringify({ status: 'success', defaultProvider: cfg.defaults.provider, providers: list }, null, 2) + '\n');
  else list.forEach((p) => process.stdout.write(`${p.enabled ? '●' : '○'} ${p.id.padEnd(10)} ${p.name.padEnd(16)} ${p.requiresLogin ? 'login' : 'no-login'}  ${p.url}\n`));
}

async function cmdStatus(args) {
  const cfg = loadConfig();
  const version = await probeCdp(cfg.browser.port);
  const chromePath = findChromePath(cfg);
  const report = {
    status: 'success',
    chromePath: chromePath || null,
    chromeFound: !!chromePath,
    cdp: version ? { connected: true, port: cfg.browser.port, browser: version.Browser } : { connected: false, port: cfg.browser.port },
    profileDir: cfg.browser.profileDir,
    defaultProvider: cfg.defaults.provider,
    timeoutMs: cfg.defaults.timeoutMs,
  };
  if (!args.flags['--json'] && process.stdout.isTTY) {
    process.stdout.write(`Chrome binary : ${report.chromePath || 'NOT FOUND'}\n`);
    process.stdout.write(`CDP (${report.cdp.port})   : ${report.cdp.connected ? 'connected — ' + report.cdp.browser : 'not running'}\n`);
    process.stdout.write(`Profile dir   : ${report.profileDir}\n`);
    process.stdout.write(`Default       : ${report.defaultProvider} (timeout ${report.timeoutMs / 1000}s)\n`);
  } else {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  }
}

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
      case 'providers':
        await cmdProviders(args);
        break;
      case 'status':
        await cmdStatus(args);
        break;
      case 'version':
        process.stdout.write('agent-web-ai 0.1.0-mvp\n');
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
