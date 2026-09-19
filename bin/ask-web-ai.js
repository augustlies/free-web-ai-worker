#!/usr/bin/env node
/** Executable entry point. */
import { main } from '../src/cli.js';

main().catch((err) => {
  process.stderr.write(`fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
