import { describe, expect, it } from 'vitest';
import { parseContentPackageManifest } from '../../../shared/content-package';

function packageManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'example-adventure',
    name: '示例冒险',
    description: '内容包契约测试',
    version: 1,
    sceneCount: 1,
    npcCount: 1,
    scenes: [{
      key: 'chapter-1-entry',
      name: '第一章 · 入口',
      chapter: '第一章',
      unlocked: false,
      map: {
        assetId: 'map-entry-0123456789ab',
        width: 100,
        height: 80,
        contentType: 'image/png',
        mapScale: 2,
      },
      tokens: [{
        kind: 'npc',
        name: '守门人',
        entryId: 'npc:npc-gatekeeper',
        x: 20,
        y: 30,
        size: 50,
        avatar: '',
        color: '#8b5cf6',
        hp: { current: 8, max: 12 },
        hidden: true,
        publicName: '蒙面人',
        hpVisibility: 'bar',
      }],
    }],
    npcs: [{
      id: 'npc-gatekeeper',
      name: '守门人',
      aliases: [],
      role: '门卫',
      location: '入口',
      status: 'active',
      importance: 'minor',
      faction: '中立',
      groupPath: ['中立'],
      statReference: { kind: 'custom' },
      notesMarkdown: '**身份**：门卫',
      playerAccess: 'limited',
      publicDescription: '负责看守入口。',
      sourceFile: '中立/守门人.json',
      updatedAt: 0,
    }],
  };
}

describe('campaign content package contract', () => {
  it('normalizes a valid package and preserves player visibility settings', () => {
    const result = parseContentPackageManifest(packageManifest(), 'example-adventure');

    expect(result.scenes[0].tokens[0]).toMatchObject({
      hidden: true,
      publicName: '蒙面人',
      hpVisibility: 'bar',
    });
    expect(result.npcs[0]).toMatchObject({
      faction: '中立',
      groupPath: ['中立'],
      playerAccess: 'limited',
      publicDescription: '负责看守入口。',
    });
  });

  it('rejects stale generated counts and duplicate stable identifiers', () => {
    const stale = packageManifest();
    stale.sceneCount = 2;
    expect(() => parseContentPackageManifest(stale)).toThrow('counts mismatch');

    const duplicate = packageManifest();
    duplicate.npcCount = 2;
    duplicate.npcs = [...duplicate.npcs as unknown[], { ...(duplicate.npcs as Record<string, unknown>[])[0] }];
    expect(() => parseContentPackageManifest(duplicate)).toThrow('duplicate content package npc id');
  });

  it('rejects broken NPC references and tokens outside map world bounds', () => {
    const brokenReference = packageManifest();
    const scenes = brokenReference.scenes as Array<{ tokens: Array<Record<string, unknown>> }>;
    scenes[0].tokens[0].entryId = 'npc:missing';
    expect(() => parseContentPackageManifest(brokenReference)).toThrow('unknown npc token reference');

    const outside = packageManifest();
    const outsideScenes = outside.scenes as Array<{ tokens: Array<Record<string, unknown>> }>;
    outsideScenes[0].tokens[0].x = 170;
    expect(() => parseContentPackageManifest(outside)).toThrow('outside map bounds');
  });

  it('rejects current hit points above maximum hit points', () => {
    const invalid = packageManifest();
    const scenes = invalid.scenes as Array<{ tokens: Array<{ hp: { current: number } }> }>;
    scenes[0].tokens[0].hp.current = 13;
    expect(() => parseContentPackageManifest(invalid)).toThrow('current hit points exceed maximum');
  });
});
