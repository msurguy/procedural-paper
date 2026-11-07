#!/usr/bin/env node
// Prepare a release PR: bump the library version, move the CHANGELOG's
// "Unreleased" notes under the new version, run the checks, and commit on a
// release branch. Merging the PR to main publishes to npm (see
// .github/workflows/publish.yml).
//
//   pnpm release patch|minor|major|<x.y.z> [--push] [--skip-checks]
//
// --push also pushes the branch and opens the PR with the GitHub CLI.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const PKG = 'packages/paper/package.json';
const CHANGELOG = 'CHANGELOG.md';
const args = process.argv.slice(2);
const bump = args.find((a) => !a.startsWith('--'));
const push = args.includes('--push');
const skipChecks = args.includes('--skip-checks');

const fail = (msg) => { console.error(`\n✖ ${msg}`); process.exit(1); };
const run = (cmd, cmdArgs, opts = {}) => execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe' });
const git = (...a) => run('git', a).trim();

if (!bump) fail('Usage: pnpm release patch|minor|major|<x.y.z> [--push] [--skip-checks]');

const pkg = JSON.parse(readFileSync(PKG, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map(Number);
const next = { patch: `${maj}.${min}.${pat + 1}`, minor: `${maj}.${min + 1}.0`, major: `${maj + 1}.0.0` }[bump] ?? bump;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(next)) fail(`Not a valid version: ${next}`);

// Start from an up-to-date main, without touching unrelated local work.
if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('Run this from the main branch.');
git('fetch', 'origin', 'main', '--tags');
if (git('rev-parse', 'HEAD') !== git('rev-parse', 'origin/main')) fail('Local main differs from origin/main. Run git pull first.');
const dirty = git('status', '--porcelain', '--', 'packages/paper', 'apps/demo/src', CHANGELOG);
if (dirty) fail(`Commit or stash these changes first:\n${dirty}`);
if (git('tag', '--list', `v${next}`)) fail(`Tag v${next} already exists.`);
try {
  run('npm', ['view', `procedural-paper@${next}`, 'version']).trim() && fail(`procedural-paper@${next} is already on npm.`);
} catch { /* 404: version is free */ }

// CHANGELOG: "## Unreleased" (with notes) becomes "## <next>", and a fresh
// empty Unreleased section goes on top for the next round of changes.
const log = readFileSync(CHANGELOG, 'utf8');
const m = log.match(/^## Unreleased\s*\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
if (!m || !m[1].trim()) fail(`Add release notes under "## Unreleased" in ${CHANGELOG} first.`);
writeFileSync(CHANGELOG, log.replace(m[0], `## Unreleased\n\n## ${next}\n\n${m[1].trim()}\n\n`));

pkg.version = next;
writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
console.log(`procedural-paper ${maj}.${min}.${pat} → ${next}`);

if (!skipChecks) {
  for (const script of ['typecheck', 'test', 'build', 'check:package']) {
    console.log(`\n▶ pnpm ${script}`);
    try { run('pnpm', [script], { inherit: true }); } catch {
      git('checkout', '--', PKG, CHANGELOG);
      fail(`pnpm ${script} failed; version bump reverted.`);
    }
  }
}

const branch = `release-v${next}`;
git('switch', '-c', branch);
git('add', PKG, CHANGELOG);
git('commit', '-m', `Release v${next}`);
console.log(`\n✔ Committed "Release v${next}" on ${branch}.`);

const notes = m[1].trim();
if (push) {
  run('git', ['push', '-u', 'origin', branch], { inherit: true });
  run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', `Release v${next}`, '--body', `${notes}\n\nMerging publishes procedural-paper@${next} to npm.`], { inherit: true });
} else {
  console.log(`\nNext:\n  git push -u origin ${branch}\n  gh pr create --fill   # or open the PR on GitHub\nMerging the PR publishes procedural-paper@${next} to npm.`);
}
