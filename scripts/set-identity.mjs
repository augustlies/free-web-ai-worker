/**
 * Fill in your GitHub identity everywhere it is needed.
 *
 *   node scripts/set-identity.mjs --username your-github-username --email 12345678+your-github-username@users.noreply.github.com
 *
 * Options:
 *   --username <gh-user>   required, your GitHub login
 *   --email <address>      required, use your GitHub noreply address to stay private
 *   --name "<display>"     optional, defaults to the username
 *   --rewrite-history      re-author every existing commit to this identity
 *                          (safe: only run before the repo is ever pushed)
 *
 * Safe to run more than once.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i > -1 ? args[i + 1] : null;
};

const username = get('--username');
const email = get('--email');
const name = get('--name') || username;

if (!username || !email) {
  console.error('usage: node scripts/set-identity.mjs --username <gh-user> --email <email> [--name "<display name>"] [--rewrite-history]');
  process.exit(2);
}
if (!/^[A-Za-z0-9-]+$/.test(username)) {
  console.error('username may only contain letters, digits and hyphens');
  process.exit(2);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('email does not look valid');
  process.exit(2);
}

const git = (a) => spawnSync('git', a, { encoding: 'utf8' });

// 1. Repo-local git identity, so new commits are attributed correctly.
git(['config', '--local', 'user.name', name]);
git(['config', '--local', 'user.email', email]);
console.log(`git identity for this repo: ${name} <${email}>`);

// 2. Optionally re-author the existing commits. Done BEFORE touching files so
//    the working tree is still clean (the rewrite refuses to run otherwise).
if (args.includes('--rewrite-history')) {
  const status = git(['status', '--porcelain']);
  if ((status.stdout || '').trim()) {
    console.error('\nRefusing to rewrite history: commit or stash your changes first.');
    process.exit(1);
  }

  const count = (git(['rev-list', '--count', 'HEAD']).stdout || '').trim();
  console.log(`\nRe-authoring ${count} commit(s)...`);

  const res = spawnSync(
    'git',
    ['rebase', '--root', '--exec', 'git commit --amend --no-edit --reset-author'],
    { encoding: 'utf8' },
  );
  if (res.status !== 0) {
    console.error('history rewrite failed:');
    console.error((res.stdout || '').split('\n').slice(-10).join('\n'));
    console.error((res.stderr || '').split('\n').slice(-10).join('\n'));
    console.error('\nThe original history is still reachable via `git reflog`.');
    process.exit(1);
  }
  console.log('Done. Authors now:');
  console.log(git(['log', '--format=%h  %an <%ae>  %s']).stdout || '');
}

// 3. Replace the placeholders in tracked files.
const TARGETS = [
  'package.json',
  'README.md',
  'README.zh-CN.md',
  'CHANGELOG.md',
  'skills/free-web-ai-worker/SKILL.md',
];

let touched = 0;
for (const file of TARGETS) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    console.warn(`skip (missing): ${file}`);
    continue;
  }
  const before = text;
  text = text
    .replaceAll('YOUR_GITHUB_USERNAME', username)
    .replaceAll('YOUR_NAME', name)
    .replaceAll('YOUR_EMAIL', email);
  if (text !== before) {
    writeFileSync(file, text);
    touched++;
    console.log(`updated: ${file}`);
  } else {
    console.log(`unchanged: ${file}`);
  }
}

console.log(`\n${touched} file(s) updated.`);
console.log('\nNext (only when you are ready to publish):');
console.log('  git add -A && git commit -m "Fill in repository identity"');
console.log(`  git remote add origin https://github.com/${username}/free-web-ai-worker.git`);
console.log('  git push -u origin main');
