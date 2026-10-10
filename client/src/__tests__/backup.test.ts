import { describe, expect, it } from 'vitest';
import { SCENE_BACKUP_FORMAT, SCENE_BACKUP_VERSION, buildSceneBackup, parseSceneBackup } from '../backup';
import type { Scene } from '../types';

const scene: Scene = {
  id: 'scene-live',
  name: '地下水道',
  mapImage: null,
  mapSize: [1600, 1200],
  mapScale: 1,
  grid: { size: 100, color: '#00000040', offset: [0, 0], snap: true },
  playArea: { x: 0, y: 0, w: 1600, h: 1200 },
  tokens: [{
    id: 'token-live', kind: 'monster', name: '地精', entryId: 'MM__Goblin', x: 200, y: 300,
    size: 100, avatar: '', color: '#e53e3e', hp: { current: 4, max: 7 },
  }],
  players: [{
    id: 'player-live', kind: 'player', name: '玩家角色', entryId: null, x: 50, y: 50,
    size: 100, avatar: '', color: '#3182ce', sessionId: 'server-owned-user',
  }],
  walls: [{ id: 'wall-live', p1: [0, 0], p2: [100, 100] }],
  initiative: [{
    id: 'initiative-live', name: '地精', value: 16, source: 'dm', sessionId: null, tokenId: 'token-live', active: true,
  }],
  favorites: [{ type: 'monster', entryId: 'MM__Goblin' }],
  fog: [true, false],
  unlocked: true,
};

describe('scene backup', () => {
  it('creates a portable board backup without retired grid visibility or server-owned player state', async () => {
    const { backup } = await buildSceneBackup(scene, {
      id: 'campaign-live', name: '失落矿坑', sceneIds: ['scene-live'], enemies: [{ entryId: 'MM__Goblin', nameZh: '地精' }],
    });

    expect(backup.scene.name).toBe('地下水道');
    expect(backup.scene.tokens).toHaveLength(1);
    expect(backup.scene).not.toHaveProperty('players');
    expect(backup.scene).not.toHaveProperty('initiative');
    expect(backup.scene.grid).toEqual({ size: 100, offset: [0, 0], snap: true });
  });

  it('parses a supported local backup and rejects unsupported versions', () => {
    const source = {
      format: SCENE_BACKUP_FORMAT,
      version: SCENE_BACKUP_VERSION,
      exportedAt: '2026-08-10T00:00:00.000Z',
      assets: {
        'asset-1': { name: 'map.png', type: 'image/png', data: 'aGVsbG8=' },
      },
      scene: {
        name: '导入场景',
        mapSize: [1000, 800],
        mapScale: 1,
        mapAssetId: 'asset-1',
        // An old/hand-edited field is ignored rather than bringing grid display back.
        grid: { size: 50, offset: [0, 0], snap: false, show: true },
        playArea: { x: 0, y: 0, w: 1000, h: 800 },
        tokens: [],
        walls: [],
        favorites: [],
        unlocked: false,
      },
    };

    const parsed = parseSceneBackup(JSON.stringify(source));
    expect(parsed.scene.mapAssetId).toBe('asset-1');
    expect(parseSceneBackup(JSON.stringify({ ...source, version: 1 })).scene.mapAssetId).toBe('asset-1');
    expect(parsed.scene.grid).toEqual({ size: 50, offset: [0, 0], snap: false });

    expect(() => parseSceneBackup(JSON.stringify({ ...source, version: 99 }))).toThrow('不支持的备份文件版本');
  });
  it('round trips precise reveals without a raster and rejects invalid rectangle data', async () => {
    const fogReveals=[{x:113.25,y:117.5,width:6.5,height:5.25}];
    const {backup}=await buildSceneBackup({...scene,fog:undefined,fogReveals},null);
    expect(parseSceneBackup(JSON.stringify(backup)).scene.fogReveals).toEqual(fogReveals);
    expect(backup.scene.fog).toBeUndefined();
    backup.scene.fogReveals![0].width=0;
    expect(()=>parseSceneBackup(JSON.stringify(backup))).toThrow();
    expect(fogReveals[0].width).toBe(6.5);
  });
  it('retains the fixed fog density through backup parsing', async () => {
    const {backup} = await buildSceneBackup(scene, null);
    backup.scene.fogBasisScale = 2;backup.scene.mapScale = 3;
    const parsed = parseSceneBackup(JSON.stringify(backup));
    expect(parsed.scene.fogBasisScale).toBe(2);expect(parsed.scene.mapScale).toBe(3);expect(parsed.scene.fog).toEqual(scene.fog);
    expect(() => parseSceneBackup(JSON.stringify({...backup,scene:{...backup.scene,fogBasisScale:0}}))).toThrow();
  });

});
