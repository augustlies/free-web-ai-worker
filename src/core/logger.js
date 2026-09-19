/**
 * Logging helper.
 *
 * IMPORTANT: all logs go to STDERR. STDOUT is reserved for the structured
 * JSON result so that callers can pipe `ask-web-ai ask --json` straight into
 * `JSON.parse` without stripping noise.
 */

let LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
let currentLevel = LEVELS.info;
let sink = (line) => process.stderr.write(line + '\n');

export function configureLogger({ level, onLine } = {}) {
  if (level && level in LEVELS) currentLevel = LEVELS[level];
  if (typeof onLine === 'function') sink = onLine;
}

export function getLogLevel() {
  return currentLevel;
}

function emit(levelName, message, meta) {
  if (LEVELS[levelName] > currentLevel) return;
  const stamp = new Date().toISOString().slice(11, 19);
  const tag = levelName.toUpperCase().padEnd(5);
  let line = `[${stamp}] ${tag} ${message}`;
  if (meta && Object.keys(meta).length) {
    try {
      line += ' ' + JSON.stringify(meta);
    } catch {
      line += ' <unserializable meta>';
    }
  }
  sink(line);
}

export const log = {
  error: (m, meta) => emit('error', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  info: (m, meta) => emit('info', m, meta),
  debug: (m, meta) => emit('debug', m, meta),
};

/** Simple stopwatch for per-step timing. */
export function stopwatch() {
  const start = Date.now();
  return {
    elapsed: () => Date.now() - start,
    /** Human readable duration for logs. */
    human: () => ((Date.now() - start) / 1000).toFixed(1) + 's',
  };
}
