/**
 * Fill in your GitHub identity everywhere it is needed.
 *
 *   node scripts/set-identity.mjs --username your-github-username --email 12345678+your-github-username@users.noreply.github.com
 *
 * Replaces the YOUR_GITHUB_USERNAME / YOUR_NAME / YOUR_EMAIL placeholders in
 * README.md, README.zh-CN.md, CHANGELOG.md, package.json and the skill, then
 * sets this repo's local git identity so future commits are attributed to you.
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
  console.error('usage: node scripts/set-identity.mjs --username <gh-user> --email <email> [--name "<display name>"]');
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

// Local-only git identity so commits are attributed correctly.
const run = (cmdArgs) => spawnSync('git', cmdArgs, { encoding: 'utf8' });
run(['config', '--local', 'user.name', name]);
run(['config', '--local', 'user.email', email]);

console.log(`\nDone. ${touched} file(s) updated.`);
console.log(`git identity for this repo: ${name} <${email}>`);

// Rewrite the author of every existing commit so the public history shows the
// real owner instead of the placeholder identity used during development.
if (args.includes('--rewrite-history')) {
  console.log('\nRewriting commit authors...');
  const status = run(['status', '--porcelain']);
  if ((status.stdout || '').trim()) {
    console.error('Refusing to rewrite history: commit or stash your changes first.');
    process.exit(1);
  }
  const current = run(['branch', '--show-current']).stdout?.trim() || 'main';
  const filter = [
    'git',
    '-c',
    `user.name=${name}`,
    '-c',
    `user.email=${email}`,
    'filter-branch',
    '-f',
    '--env-filter',
    `export GIT_AUTHOR_NAME="${name}" GIT_AUTHOR_EMAIL="${email}" GIT_COMMITTER_NAME="${name}" GIT_COMMITTER_EMAIL="${email}"`,
    '--',
    '--all',
  ];
  const res = spawnSync(filter[0], filter.slice(1), { encoding: 'utf8', shell: process.platform === 'win32' });
  if (res.status !== 0) {
    console.error('history rewrite failed:');
    console.error((res.stderr || '').split('\n').slice(-15).join('\n'));
    process.exit(1);
  }
  // Point the branch at the rewritten history and drop the backup ref.
  run(['update-ref', '-d', 'refs/original/refs/heads/' + current]);
  console.log('Commit authors rewritten.');
  console.log('\nAuthors now:');
  console.log(run(['log', '--format=%h  %an <%ae>  %s']).stdout || '');
}

console.log('\nNext:');
console.log('  git add -A && git commit -m "Fill in repository identity"');
console.log(`  git remote add origin https://github.com/${username}/free-web-ai-worker.git`);
console.log('  git push -u origin main');


