import { describe, expect, it } from 'vitest';
import { applyOptimisticOps } from '../optimistic';
import type { Scene } from '../types';

const scene: Scene = {
  id: 'scene-1',
  name: 'Fast table',
  mapImage: null,
  mapSize: [1200, 800],
  grid: { size: 100, color: '#00000040', offset: [0, 0], snap: true },
  playArea: { x: 0, y: 0, w: 1200, h: 800 },
  tokens: [{ id: 'goblin', kind: 'monster', name: 'Goblin', entryId: 'MM__Goblin', x: 100, y: 100, size: 48, avatar: '', color: '#fff' }],
  players: [{ id: 'hero', kind: 'player', name: 'Hero', entryId: null, x: 200, y: 200, size: 48, avatar: '', color: '#38a169', sessionId: 'viewer' }],
  walls: [],
  initiative: [],
  favorites: [],
  fog: [false, true, false],
};

describe('optimistic room projection', () => {
  it('updates a small player edit without copying unrelated board data', () => {
    const result = applyOptimisticOps({ scene, campaign: null }, [{
      op: 'updatePlayer', tokenId: 'hero', patch: { name: 'Quick Hero' },
    }]);

    expect(result).not.toBeNull();
    expect(result!.scene).not.toBe(scene);
    expect(result!.scene.players).not.toBe(scene.players);
    expect(result!.scene.players[0].name).toBe('Quick Hero');
    expect(result!.scene.tokens).toBe(scene.tokens);
    expect(result!.scene.fog).toBe(scene.fog);
    expect(result!.scene.grid).toBe(scene.grid);
  });

  it('declines commands whose final shape depends on a server-generated ID', () => {
    expect(applyOptimisticOps({ scene, campaign: null }, [{
      op: 'addToInitiative', name: 'Goblin', value: 13, source: 'dm', tokenId: 'goblin',
    }])).toBeNull();
    expect(applyOptimisticOps({ scene, campaign: null }, [{
      op: 'setCombatantHidden', entryId: 'initiative-1', hidden: true,
    }])).toBeNull();
  });

  it('keeps token deletion separate and waits for authoritative encounter removal', () => {
    const linkedScene: Scene = {
      ...scene,
      tokens: [
        scene.tokens[0],
        { ...scene.tokens[0], id: 'goblin-2', x: 220 },
      ],
      initiative: [
        { id: 'ini-1', name: 'Goblin #1', value: 15, source: 'dm', sessionId: null, tokenId: 'goblin', active: false },
        { id: 'ini-2', name: 'Goblin #2', value: 12, source: 'dm', sessionId: null, tokenId: 'goblin-2', active: false },
      ],
    };

    const fromEnemyList = applyOptimisticOps({ scene: linkedScene, campaign: null }, [
      { op: 'removeToken', tokenId: 'goblin' },
    ]);
    expect(fromEnemyList?.scene.tokens.map(token => token.id)).toEqual(['goblin-2']);
    expect(fromEnemyList?.scene.initiative.map(entry => entry.id)).toEqual(['ini-1', 'ini-2']);

    const fromInitiative = applyOptimisticOps({ scene: linkedScene, campaign: null }, [
      { op: 'removeFromInitiative', entryId: 'ini-2' },
    ]);
    expect(fromInitiative).toBeNull();
  });

  it('waits for the server encounter snapshot when removing an NPC combatant', () => {
    const npcScene: Scene = {
      ...scene,
      tokens: [{ ...scene.tokens[0], id: 'npc-token', kind: 'npc', name: '老乔', entryId: 'npc:npc-joe' }],
      initiative: [{ id: 'npc-initiative', name: '老乔 #1', value: 14, source: 'dm', sessionId: null, tokenId: 'npc-token', active: false }],
    };
    const result = applyOptimisticOps({ scene: npcScene, campaign: null }, [
      { op: 'removeFromInitiative', entryId: 'npc-initiative' },
    ]);
    expect(result).toBeNull();
  });

  it('waits for the server encounter snapshot when removing a manual combatant', () => {
    const manualScene: Scene = {
      ...scene,
      initiative: [{ id: 'manual', name: 'Lair action', value: 20, source: 'dm', sessionId: null, tokenId: null, active: false }],
    };
    const result = applyOptimisticOps({ scene: manualScene, campaign: null }, [
      { op: 'removeFromInitiative', entryId: 'manual' },
    ]);
    expect(result).toBeNull();
  });

  it('projects a pixel-precise fog reveal box without changing the legacy grid', () => {
    const rect = { x: 12.5, y: 27.25, w: 83.75, h: 46.5 };
    const result = applyOptimisticOps({ scene, campaign: null }, [{ op: 'revealFogRect', rect }]);

    expect(result?.scene.fogReveals).toEqual([rect]);
    expect(result?.scene.fog).toBe(scene.fog);
  });

  it('predicts campaign NPC archive updates and removal', () => {
    const campaign = { id: 'campaign', name: 'NPC campaign', sceneIds: [scene.id], enemies: [], npcs: [] };
    const npc = {
      id: 'npc-1', name: '老乔', aliases: [], role: '老板', location: '旅店', status: 'active' as const,
      notesMarkdown: '知道密道。', sourceFile: 'npc.md', updatedAt: 1,
    };
    const added = applyOptimisticOps({ scene, campaign }, [{ op: 'upsertNpc', npc }]);
    expect(added?.campaign?.npcs).toEqual([npc]);
    const removed = applyOptimisticOps(added!, [{ op: 'removeNpc', npcId: npc.id }]);
    expect(removed?.campaign?.npcs).toEqual([]);
  });
});
