import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const run = (command, args) => {
  const result = spawnSync(command, args, { env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal}).`);
};
if (process.env.CI || process.env.GITHUB_ACTIONS) {
  throw new Error('Production deployment is local only. GitHub runs checks without Cloudflare credentials.');
}
if (git('branch', '--show-current') !== 'main') throw new Error('Switch to the reviewed local main branch before releasing.');
if (git('status', '--porcelain')) throw new Error('Release checkout must be clean.');
const commit = git('rev-parse', 'HEAD');
// Invocation is an explicit release request; pushes and merges never invoke this script.
run('npx', ['wrangler', 'whoami']);
for (const args of [['ci'], ['run', 'music:prepare'], ['test'], ['run', 'build'], ['run', 'release:stamp']]) run('npm', args);
if (git('status', '--porcelain') || git('rev-parse', 'HEAD') !== commit || git('branch', '--show-current') !== 'main') {
  throw new Error('Source changed during preparation; refusing to deploy.');
}
const release = JSON.parse(readFileSync('client/dist/release.json', 'utf8'));
if (release.commit !== commit) throw new Error('Build artifact does not match the release commit.');
run('npx', ['wrangler', 'deploy', '--domain', 'dnd.xiejiaxue.com', '--keep-vars', '--message', `Local Git ${commit}`]);
run('npm', ['run', 'release:verify']);
