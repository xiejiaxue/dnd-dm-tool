import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  CONTENT_PACKAGE_SCHEMA_VERSION,
  parseContentPackageManifest,
  parseContentPackageSummary,
  type ContentPackageImageType,
  type ContentPackageManifest,
  type ContentPackageSummary,
} from '../shared/content-package';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = path.join(ROOT, 'output', 'room-templates');
const argumentsWithoutFlags = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
const validateOnly = process.argv.includes('--validate-only');
const sourceSetting = process.env.CONTENT_PACKAGE_DIR?.trim() || argumentsWithoutFlags[0];

if (!sourceSetting) {
  throw new Error('请指定内容包目录：npm run content:build -- /绝对路径/内容包');
}

const sourceRoot = path.resolve(sourceSetting);
const manifestFile = path.join(sourceRoot, 'manifest.json');
const rawManifest = parseJson(await readFile(manifestFile, 'utf8'), manifestFile);
if (!isRecord(rawManifest)) throw new Error(`内容包 manifest 必须是 JSON 对象：${manifestFile}`);
const rawScenes = Array.isArray(rawManifest.scenes)
  ? rawManifest.scenes
  : await readDocumentDirectory(path.join(sourceRoot, 'scenes'), '场景');
const rawNpcs = Array.isArray(rawManifest.npcs)
  ? rawManifest.npcs
  : await readDocumentDirectory(path.join(sourceRoot, 'npcs'), 'NPC');

// Counts are generated metadata. Authors cannot accidentally leave them stale.
const manifest = parseContentPackageManifest({
  ...rawManifest,
  scenes: rawScenes,
  npcs: rawNpcs,
  sceneCount: rawScenes.length,
  npcCount: rawNpcs.length,
});
const assets = await validateAssets(sourceRoot, manifest);

if (validateOnly) {
  console.log(`[content-package] 校验通过：${manifest.name} v${manifest.version}`);
  console.log(`[content-package] ${manifest.scenes.length} 个场景，${manifest.npcs.length} 个 NPC，${assets.length} 个地图资源`);
  process.exit(0);
}

const targetRoot = path.join(OUTPUT_ROOT, manifest.id);
if (sourceRoot === targetRoot || sourceRoot.startsWith(`${targetRoot}${path.sep}`)) {
  throw new Error('内容包源码目录不能位于自己的 output 目标目录内');
}
await rm(targetRoot, { recursive: true, force: true });
await mkdir(path.join(targetRoot, 'assets'), { recursive: true });
for (const asset of assets) {
  await cp(asset.source, path.join(targetRoot, 'assets', asset.assetId));
}
await writeFile(path.join(targetRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
await updateIndex(manifest);

console.log(`[content-package] 已构建：${manifest.name} v${manifest.version}`);
console.log(`[content-package] ${manifest.scenes.length} 个场景，${manifest.npcs.length} 个 NPC，${assets.length} 个地图资源`);
console.log(`[content-package] 输出目录：${targetRoot}`);

interface ValidatedAsset {
  assetId: string;
  source: string;
}

async function readDocumentDirectory(directory: string, label: string): Promise<unknown[]> {
  const files = await jsonFilesBelow(directory).catch(error => {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(`内容包 manifest 未内嵌 ${label}，也没有 ${path.relative(sourceRoot, directory)} 目录`);
    }
    throw error;
  });
  const records: unknown[] = [];
  for (const file of files.sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }))) {
    const value = parseJson(await readFile(file, 'utf8'), file);
    if (!isRecord(value)) throw new Error(`${label}文件必须只包含一个 JSON 对象：${file}`);
    records.push(value);
  }
  return records;
}

async function jsonFilesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return jsonFilesBelow(target);
    return entry.isFile() && entry.name.toLocaleLowerCase().endsWith('.json') ? [target] : [];
  }));
  return nested.flat();
}

async function validateAssets(sourceDirectory: string, sourceManifest: ContentPackageManifest): Promise<ValidatedAsset[]> {
  const result = new Map<string, ValidatedAsset>();
  for (const scene of sourceManifest.scenes) {
    if (result.has(scene.map.assetId)) continue;
    const source = path.join(sourceDirectory, 'assets', scene.map.assetId);
    const file = await lstat(source).catch(() => null);
    if (!file?.isFile() || file.isSymbolicLink()) {
      throw new Error(`地图资源不存在或不是普通文件：assets/${scene.map.assetId}`);
    }
    const bytes = await readFile(source);
    verifyContentDigest(scene.map.assetId, bytes);
    const metadata = await sharp(bytes).metadata();
    const actualContentType = imageContentType(metadata.format);
    if (actualContentType !== scene.map.contentType) {
      throw new Error(`地图类型不匹配：${scene.map.assetId}，manifest=${scene.map.contentType}，实际=${actualContentType ?? '未知'}`);
    }
    if (metadata.width !== scene.map.width || metadata.height !== scene.map.height) {
      throw new Error(
        `地图尺寸不匹配：${scene.map.assetId}，manifest=${scene.map.width}x${scene.map.height}，实际=${metadata.width ?? '?'}x${metadata.height ?? '?'}`,
      );
    }
    result.set(scene.map.assetId, { assetId: scene.map.assetId, source });
  }
  return [...result.values()].sort((left, right) => left.assetId.localeCompare(right.assetId));
}

function verifyContentDigest(assetId: string, bytes: Uint8Array): void {
  const match = /-([a-f0-9]{12,64})$/u.exec(assetId);
  if (!match) {
    throw new Error(`资源 ID 必须以 12–64 位 SHA-256 摘要结尾：${assetId}`);
  }
  const actual = createHash('sha256').update(bytes).digest('hex').slice(0, match[1].length);
  if (actual !== match[1]) throw new Error(`资源摘要不匹配：${assetId}，实际应为 ${actual}`);
}

function imageContentType(format: string | undefined): ContentPackageImageType | null {
  if (format === 'jpeg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  if (format === 'avif' || format === 'heif') return 'image/avif';
  return null;
}

async function updateIndex(manifest: ContentPackageManifest): Promise<void> {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const indexFile = path.join(OUTPUT_ROOT, 'index.json');
  const existing = await readIndex(indexFile);
  const summary: ContentPackageSummary = {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    version: manifest.version,
    sceneCount: manifest.sceneCount,
    npcCount: manifest.npcCount,
  };
  const templates = [...existing.filter(item => item.id !== manifest.id), summary]
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true, sensitivity: 'base' }));
  await writeFile(indexFile, `${JSON.stringify({ schemaVersion: CONTENT_PACKAGE_SCHEMA_VERSION, templates }, null, 2)}\n`, 'utf8');
}

async function readIndex(indexFile: string): Promise<ContentPackageSummary[]> {
  let value: unknown;
  try {
    value = parseJson(await readFile(indexFile, 'utf8'), indexFile);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return [];
    throw error;
  }
  if (!isRecord(value) || value.schemaVersion !== CONTENT_PACKAGE_SCHEMA_VERSION || !Array.isArray(value.templates)) {
    throw new Error(`内容包索引格式无效：${indexFile}`);
  }
  return value.templates.map(parseContentPackageSummary);
}

function parseJson(source: string, filename: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch {
    throw new Error(`JSON 格式无效：${filename}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value;
}
