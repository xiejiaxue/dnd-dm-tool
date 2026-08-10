import { spawnSync } from 'node:child_process';

const hostname = (process.env.PUBLIC_SITE_DOMAIN ?? '').trim().toLowerCase();
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

if (!hostnamePattern.test(hostname)) {
  console.error('PUBLIC_SITE_DOMAIN must contain one DNS hostname, without a scheme, path, or wildcard.');
  process.exit(2);
}

const args = ['wrangler', 'deploy', '--domain', hostname];
for (const name of ['PUBLIC_ICP_FILING', 'PUBLIC_PSB_FILING']) {
  const value = process.env[name]?.trim();
  if (value) args.push('--var', `${name}:${value}`);
}

const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
  env: process.env,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
