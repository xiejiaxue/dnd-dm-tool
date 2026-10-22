import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporaryDirectories: string[] = [];
const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL2JwAAAABJRU5ErkJggg==',
  'base64',
);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('content package build CLI', () => {
  it('validates the split chapter/scene and faction/person source layout', async () => {
    const packageRoot = await createSplitPackage();
    const result = runValidator(packageRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('校验通过：测试冒险 v1');
    expect(result.stdout).toContain('1 个场景，1 个 NPC，1 个地图资源');
  });

  it('rejects an asset whose bytes do not match its content-addressed id', async () => {
    const packageRoot = await createSplitPackage('000000000000');
    const result = runValidator(packageRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('资源摘要不匹配');
  });
});

async function createSplitPackage(forcedDigest?: string): Promise<string> {
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), 'dnd-content-package-'));
  temporaryDirectories.push(packageRoot);
  await Promise.all([
    mkdir(path.join(packageRoot, 'assets'), { recursive: true }),
    mkdir(path.join(packageRoot, 'scenes', '010-第一章'), { recursive: true }),
    mkdir(path.join(packageRoot, 'npcs', '010-中立'), { recursive: true }),
  ]);
  const digest = forcedDigest ?? createHash('sha256').update(tinyPng).digest('hex').slice(0, 12);
  const assetId = `map-entry-${digest}`;
  await Promise.all([
    writeJson(path.join(packageRoot, 'manifest.json'), {
      schemaVersion: 1,
      id: 'test-adventure',
      name: '测试冒险',
      description: '验证多文件内容包',
      version: 1,
      system: 'dnd5e',
    }),
    writeJson(path.join(packageRoot, 'scenes', '010-第一章', '010-入口.json'), {
      key: 'chapter-1-entry',
      name: '第一章 · 入口',
      chapter: '第一章',
      map: { assetId, width: 1, height: 1, contentType: 'image/png', mapScale: 1 },
      tokens: [],
      unlocked: true,
    }),
    writeJson(path.join(packageRoot, 'npcs', '010-中立', '010-向导.json'), {
      id: 'npc-guide',
      name: '向导',
      aliases: [],
      role: '向导',
      location: '入口',
      status: 'active',
      importance: 'supporting',
      faction: '中立',
      groupPath: ['中立'],
      statReference: { kind: 'custom' },
      notesMarkdown: '**身份**：向导',
      sourceFile: '中立/向导.json',
      updatedAt: 0,
    }),
    writeFile(path.join(packageRoot, 'assets', assetId), tinyPng),
  ]);
  return packageRoot;
}

function runValidator(packageRoot: string): ReturnType<typeof spawnSync> {
  const executable = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  return spawnSync(executable, ['scripts/build-content-package.ts', '--validate-only', packageRoot], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function writeJson(filename: string, value: unknown): Promise<void> {
  return writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
