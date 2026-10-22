import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REF !== 'refs/heads/main' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
  throw new Error('Production releases run in GitHub Actions on main. After merging reviewed changes, manually dispatch the Production workflow on main. Pushes never deploy.');
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const latest = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8' }).split(/\s/)[0];
if (commit !== latest || commit !== process.env.GITHUB_SHA) throw new Error('Refusing to deploy an outdated main commit.');
if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Release checkout must be clean.');
const release = JSON.parse(readFileSync('client/dist/release.json', 'utf8'));
if (release.commit !== commit) throw new Error('Build artifact does not match the release commit.');
const result = spawnSync('npx', ['wrangler', 'deploy', '--domain', 'dnd.xiejiaxue.com', '--keep-vars', '--message', `Git ${commit}`], {
  env: process.env, stdio: 'inherit',
});
process.exit(result.status ?? 1);
