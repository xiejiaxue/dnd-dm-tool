// Upload the locally generated 5etools index and JSON books to the private R2
// compendium bucket. This is deliberately a Node/CI task, never Worker code.
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(ROOT, 'data', 'db');
const bucket = process.env.R2_REFERENCE_BUCKET;

if (!bucket) {
  throw new Error('请设置 R2_REFERENCE_BUCKET（Cloudflare R2 资料库 bucket 名称）后再运行 data:publish');
}
if (!existsSync(path.join(DB, 'index.json'))) {
  throw new Error('未找到 data/db/index.json；请先运行 npm run data:update');
}

const files = await jsonFiles(DB);
const uploads = [
  { file: path.join(DB, 'index.json'), key: 'compendium/index.json' },
  ...files
    .filter(file => path.relative(DB, file) !== 'index.json')
    .map(file => ({
      file,
      key: `compendium/books/${path.relative(DB, file).split(path.sep).map(encodeURIComponent).join('/')}`,
    })),
];

for (const [position, upload] of uploads.entries()) {
  await putObject(bucket, upload.key, upload.file);
  console.log(`[data-publish] ${position + 1}/${uploads.length} ${upload.key}`);
}
console.log(`[data-publish] 已发布 ${uploads.length} 个资料文件到 ${bucket}`);

async function jsonFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return jsonFiles(target);
    return entry.isFile() && entry.name.endsWith('.json') ? [target] : [];
  }));
  return nested.flat();
}

function putObject(targetBucket, key, file) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['wrangler', 'r2', 'object', 'put', `${targetBucket}/${key}`, '--file', file, '--content-type', 'application/json'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`R2 上传失败：${key}（退出码 ${code ?? 'unknown'}）`)));
  });
}
