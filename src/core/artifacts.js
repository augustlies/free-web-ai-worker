/**
 * Failure forensics.
 *
 * When a provider fails we dump a screenshot + the page HTML to
 * <profileDir>/artifacts/<timestamp>-<provider>/. This is what makes
 * "why did it fail?" answerable without re-running the whole flow.
 */

import { mkdirSync, writeFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { log } from './logger.js';

const MAX_ARTIFACT_DIRS = 20;

export function artifactDir(profileDir, providerId) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(profileDir, 'artifacts', `${stamp}-${providerId}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Capture screenshot, page HTML and a small state summary.
 * Never throws — forensics must not mask the original error.
 */
export async function captureFailure(page, profileDir, providerId, extra = {}) {
  if (!page || !profileDir) return null;
  try {
    const dir = artifactDir(profileDir, providerId);
    await page.screenshot({ path: join(dir, 'screenshot.png'), fullPage: false }).catch(() => {});
    const html = await page.content().catch(() => '');
    if (html) writeFileSync(join(dir, 'page.html'), html);
    const summary = {
      provider: providerId,
      url: (() => { try { return page.url(); } catch { return null; } })(),
      title: await page.title().catch(() => null),
      bodyText: (await page.evaluate(() => document.body?.innerText || '').catch(() => '')).slice(0, 4000),
      capturedAt: new Date().toISOString(),
      ...extra,
    };
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
    pruneOldArtifacts(profileDir);
    log.info('Failure artifacts written', { dir });
    return dir;
  } catch (err) {
    log.debug('Could not capture failure artifacts', { error: err?.message });
    return null;
  }
}

/** Keep only the newest N artifact folders so the profile does not grow forever. */
function pruneOldArtifacts(profileDir) {
  try {
    const base = join(profileDir, 'artifacts');
    const dirs = readdirSync(base)
      .map((name) => ({ name, path: join(base, name), mtime: statSync(join(base, name)).mtimeMs }))
      .filter((d) => statSync(d.path).isDirectory())
      .sort((a, b) => b.mtime - a.mtime);
    for (const d of dirs.slice(MAX_ARTIFACT_DIRS)) rmSync(d.path, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

