/**
 * Minimal MCP (Model Context Protocol) server over stdio.
 *
 * Exposes one tool — ask_web_ai — so MCP-capable agents (Cline, dsh, Codex,
 * Claude Desktop, …) can delegate text subtasks without shelling out.
 *
 * Implemented with plain JSON-RPC 2.0 on stdin/stdout: no SDK dependency, no
 * version drift. Logs go to stderr only.
 *
 * Configure an MCP client with:
 *   command: node
 *   args:    ["<abs path>/src/mcp-server.js"]
 */

import { readFileSync } from 'node:fs';
import { askWebAI } from './core/ask.js';
import { knownProviderIds } from './providers/index.js';
import { loadConfig } from './core/config.js';
import pkg from '../package.json' with { type: 'json' };

const SERVER_INFO = { name: 'free-web-ai-worker', version: pkg.version };
const PROTOCOL_VERSION = '2024-11-05';

const TOOL = {
  name: 'ask_web_ai',
  description:
    'Delegate a simple, self-contained text-only subtask to a free web AI chat (summarise, translate, classify, extract, reformat). ' +
    'Returns plain text. Do not use for tasks that need repository context, file edits, or multi-step reasoning.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Self-contained prompt. The web AI cannot see your conversation or files.' },
      provider: { type: 'string', enum: knownProviderIds(), description: 'Which web AI to use (default from config).' },
      timeout_ms: { type: 'integer', description: 'Overall timeout in milliseconds (default 120000).' },
    },
    required: ['prompt'],
  },
};

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

function reply(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function replyError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize':
      reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      return;
    case 'notifications/initialized':
      return;
    case 'tools/list':
      reply(id, { tools: [TOOL] });
      return;
    case 'tools/call': {
      const name = params?.name;
      if (name !== 'ask_web_ai') {
        replyError(id, -32602, `Unknown tool: ${name}`);
        return;
      }
      const args = params?.arguments || {};
      try {
        const result = await askWebAI({
          prompt: args.prompt,
          provider: args.provider,
          timeoutMs: args.timeout_ms,
          logLevel: process.env.AWA_LOG_LEVEL || 'info',
        });
        const text = result.status === 'success' ? result.answer : `ERROR (${result.code}): ${result.error}`;
        reply(id, {
          content: [{ type: 'text', text }],
          isError: result.status !== 'success',
          _meta: { structured: result },
        });
      } catch (err) {
        reply(id, { content: [{ type: 'text', text: `ERROR: ${err.message}` }], isError: true });
      }
      return;
    }
    case 'ping':
      reply(id, {});
      return;
    default:
      if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
  }
}

// Read newline-delimited JSON-RPC from stdin.
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stderr.write(`[mcp] bad JSON line: ${line.slice(0, 120)}\n`);
      continue;
    }
    handle(msg).catch((err) => {
      process.stderr.write(`[mcp] handler error: ${err.message}\n`);
      if (msg?.id !== undefined) replyError(msg.id, -32603, err.message);
    });
  }
});

process.stderr.write(`[mcp] free-web-ai-worker ready (providers: ${knownProviderIds().join(', ')})\n`);
