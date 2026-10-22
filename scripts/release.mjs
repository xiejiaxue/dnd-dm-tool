import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'client/dist');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const hosted = await readJson(path.join(root, 'client/src/music/hosted.json'));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

async function listFiles(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path.join(directory, entry.name), name));
    else if (entry.isFile()) result.push(name);
    else throw new Error(`Unsupported build entry: ${name}`);
  }
  return result.sort();
}

if (process.argv[2] === 'stamp') {
  const music = new Set(hosted.map((track) => path.basename(track.audio)));
  // Remove obsolete music from build output only, never source or user data.
  for (const file of await readdir(path.join(dist, 'music'))) {
    if (file.endsWith('.mp3') && !music.has(file)) await rm(path.join(dist, 'music', file));
  }
  const credits = await readJson(path.join(dist, 'music/credits.json'));
  for (const track of credits) {
    const bytes = await readFile(path.join(dist, track.audio.replace(/^\//, '')));
    if (bytes.length !== track.bytes || hash(bytes) !== track.sha256) throw new Error(`Invalid audio: ${track.id}`);
  }
  const assets = {};
  for (const file of await listFiles(dist)) {
    if (['release.json', '_headers', '_redirects', '.assetsignore'].includes(file)) continue;
    assets[file] = hash(await readFile(path.join(dist, file)));
  }
  const release = { commit, builtAt: new Date().toISOString(), run: process.env.GITHUB_RUN_ID ?? null, assets };
  await writeFile(path.join(dist, 'release.json'), JSON.stringify(release, null, 2) + '\n');
  console.log(`Stamped ${commit}: ${Object.keys(assets).length} assets, ${music.size} music files`);
} else if (process.argv[2] === 'verify') {
  const expected = await readJson(path.join(dist, 'release.json'));
  const origin = 'https://dnd.xiejiaxue.com';
  const get = async (pathname) => {
    const url = new URL(pathname, origin);
    url.searchParams.set('release', commit);
    const response = await fetch(url, { signal: AbortSignal.timeout(60000), cache: 'no-store' });
    if (!response.ok) throw new Error(`${pathname}: HTTP ${response.status}`);
    return response;
  };
  const actual = await (await get('/release.json')).json();
  if (actual.commit !== commit || JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Live release metadata does not match this build.');
  for (const pathname of ['/', '/dice', '/tavern', '/calculator', '/characters', '/music']) {
    const response = await get(pathname);
    if (hash(Buffer.from(await response.arrayBuffer())) !== expected.assets['index.html']) throw new Error(`Unexpected HTML: ${pathname}`);
  }
  const health = await (await get('/api/health')).json();
  if (health.ok !== true || health.runtime !== 'cloudflare-worker') throw new Error('Worker health check failed');
  for (const [file, checksum] of Object.entries(expected.assets)) {
    if (file === 'index.html') continue;
    const response = await get('/' + file);
    if (hash(Buffer.from(await response.arrayBuffer())) !== checksum) throw new Error(`Live asset mismatch: ${file}`);
  }
  console.log(`Verified live commit ${commit}, six pages, Worker health, and ${Object.keys(expected.assets).length} asset hashes.`);
} else {
  throw new Error('Usage: node scripts/release.mjs stamp|verify');
}
