/**
 * Pre-publish guard: refuse to pack if the offline tests fail.
 *
 * Output is captured and discarded on success. This keeps `npm pack --json`
 * machine-readable -- the test runner's own progress output would otherwise be
 * merged into npm's stdout and corrupt the JSON.
 */

import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--test', 'tests/unit.test.js', 'tests/throttle.test.js', 'tests/router.test.js'],
  { encoding: 'utf8' },
);

if (result.status !== 0) {
  process.stderr.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  process.stderr.write('\nprepack: offline tests failed -- refusing to pack.\n');
  process.exit(1);
}

const passed = (result.stdout || '').match(/# pass (\d+)/);
process.stderr.write(`prepack: ${passed ? passed[1] : 'all'} offline tests passed.\n`);
