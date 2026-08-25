import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(ROOT, 'output', 'room-templates');
const bucket = process.env.R2_REFERENCE_BUCKET;
const selectedTemplateId = process.env.ROOM_TEMPLATE_ID?.trim();

if (!bucket) throw new Error('请设置 R2_REFERENCE_BUCKET（Cloudflare R2 资料库 bucket 名称）');
if (!existsSync(path.join(sourceRoot, 'index.json'))) throw new Error('未找到模板输出；请先运行 template:build:waterdeep');
if (selectedTemplateId && !/^[a-z0-9][a-z0-9-]{0,79}$/u.test(selectedTemplateId)) {
  throw new Error(`ROOM_TEMPLATE_ID 格式无效：${selectedTemplateId}`);
}

const allFiles = await filesBelow(sourceRoot);
const assetContentTypes = await assetTypesFromManifests(allFiles);
const selectedFiles = allFiles
  .filter(file => {
    if (!selectedTemplateId) return true;
    const relative = path.relative(sourceRoot, file).split(path.sep).join('/');
    return relative === 'index.json' || relative.startsWith(`${selectedTemplateId}/`);
  });
if (selectedTemplateId && !selectedFiles.some(file => path.relative(sourceRoot, file).split(path.sep).join('/').startsWith(`${selectedTemplateId}/`))) {
  throw new Error(`未找到模板输出：${selectedTemplateId}`);
}
const temporaryRoot = selectedTemplateId ? await mkdtemp(path.join(os.tmpdir(), 'dnd-room-template-')) : null;
try {
  const uploadFiles = selectedFiles.map(file => ({
    file,
    relative: path.relative(sourceRoot, file).split(path.sep).join('/'),
  }));
  if (selectedTemplateId && temporaryRoot) {
    const mergedIndexFile = path.join(temporaryRoot, 'index.json');
    await writeMergedIndex(bucket, path.join(sourceRoot, 'index.json'), mergedIndexFile, selectedTemplateId);
    const indexEntry = uploadFiles.find(entry => entry.relative === 'index.json');
    if (!indexEntry) throw new Error('本地模板索引缺失');
    indexEntry.file = mergedIndexFile;
  }
  uploadFiles.sort((left, right) => {
    if (left.relative === 'index.json') return 1;
    if (right.relative === 'index.json') return -1;
    return left.relative.localeCompare(right.relative);
  });
  for (const [index, entry] of uploadFiles.entries()) {
    const key = `room-templates/${entry.relative}`;
    const contentType = entry.relative.endsWith('.json')
      ? 'application/json'
      : assetContentTypes.get(path.resolve(entry.file)) ?? 'application/octet-stream';
    await putObject(bucket, key, entry.file, contentType);
    console.log(`[room-template] ${index + 1}/${uploadFiles.length} ${key}`);
  }
  console.log(`[room-template] 已发布 ${uploadFiles.length} 个模板对象到 ${bucket}`);
} finally {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(target) : entry.isFile() ? [target] : [];
  }));
  return nested.flat();
}

async function assetTypesFromManifests(files) {
  const contentTypes = new Map();
  const manifests = files.filter(file => path.basename(file) === 'manifest.json');
  for (const manifestFile of manifests) {
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    for (const scene of Array.isArray(manifest?.scenes) ? manifest.scenes : []) {
      const assetId = scene?.map?.assetId;
      const contentType = scene?.map?.contentType;
      if (typeof assetId !== 'string' || typeof contentType !== 'string') continue;
      contentTypes.set(path.resolve(path.dirname(manifestFile), 'assets', assetId), contentType);
    }
  }
  return contentTypes;
}

async function writeMergedIndex(targetBucket, localIndexFile, outputFile, templateId) {
  const local = JSON.parse(await readFile(localIndexFile, 'utf8'));
  const selected = Array.isArray(local?.templates)
    ? local.templates.find(template => template?.id === templateId)
    : null;
  if (!selected) throw new Error(`本地模板索引中找不到：${templateId}`);
  const remoteText = await getObject(targetBucket, 'room-templates/index.json');
  const remote = JSON.parse(remoteText);
  const existing = remote?.schemaVersion === 1 && Array.isArray(remote.templates) ? remote.templates : [];
  const templates = [...existing.filter(template => template?.id !== templateId), selected]
    .sort((left, right) => String(left?.name ?? '').localeCompare(String(right?.name ?? ''), 'zh-CN', { numeric: true }));
  await writeFile(outputFile, `${JSON.stringify({ schemaVersion: 1, templates }, null, 2)}\n`, 'utf8');
}

function getObject(targetBucket, key) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const child = spawn('npx', [
      'wrangler', 'r2', 'object', 'get', `${targetBucket}/${key}`, '--remote', '--pipe',
    ], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' });
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.once('error', reject);
    child.once('exit', code => code === 0
      ? resolve(Buffer.concat(chunks).toString('utf8'))
      : reject(new Error(`R2 读取失败：${key}（退出码 ${code ?? 'unknown'}）`)));
  });
}

function putObject(targetBucket, key, file, contentType) {
  return retry(
    () => putObjectOnce(targetBucket, key, file, contentType),
    error => console.warn(`[room-template] 上传失败，准备重试 ${key}: ${error.message}`),
  );
}

async function retry(operation, onRetry, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      onRetry(error);
      await new Promise(resolve => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

function putObjectOnce(targetBucket, key, file, contentType) {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', [
      'wrangler', 'r2', 'object', 'put', `${targetBucket}/${key}`,
      '--remote', '--file', file, '--content-type', contentType,
      '--cache-control', contentType === 'application/json' ? 'no-cache' : 'private, max-age=86400',
    ], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`R2 上传失败：${key}（退出码 ${code ?? 'unknown'}）`)));
  });
}
