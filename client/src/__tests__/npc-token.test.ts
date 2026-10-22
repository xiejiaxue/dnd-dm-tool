import { describe, expect, it } from 'vitest';
import { createNpcToken, findNpcForToken, npcEntryId, npcQuickReferenceForToken } from '../features/npc/token';
import type { NpcRecord, Scene } from '../types';

const scene = {
  playArea: { x: 0, y: 0, w: 1200, h: 800 },
  tokens: [],
} as unknown as Scene;

const npc: NpcRecord = {
  id: 'npc-one', name: '老乔', aliases: [], role: '酒馆老板', location: '跃马旅店',
  status: 'active', notesMarkdown: '', sourceFile: null, updatedAt: 1,
};

describe('NPC token creation', () => {
  it('creates a board token linked to its campaign NPC without impersonating a monster', () => {
    expect(createNpcToken(scene, npc, 'token-one')).toEqual({
      id: 'token-one',
      kind: 'npc',
      name: '老乔',
      entryId: npcEntryId('npc-one'),
      x: 100,
      y: 100,
      size: 100,
      avatar: '',
      color: '#0ea5e9',
    });
  });

  it('uses referenced artwork and hit points when NPC rules data is available', () => {
    expect(createNpcToken(scene, npc, 'token-two', { avatar: '/api/token/MM__Veteran', hitPoints: 58 })).toMatchObject({
      avatar: '/api/token/MM__Veteran', hp: { current: 58, max: 58 }, size: 100,
    });
  });

  it('opens NPC details from exact links and legacy token names', () => {
    expect(findNpcForToken({ kind: 'npc', entryId: 'npc:npc-one', name: '旧名称' }, [npc])?.id).toBe('npc-one');
    expect(findNpcForToken({ kind: 'npc', entryId: 'npc:deleted-fragment', name: '老乔 #1' }, [npc])?.id).toBe('npc-one');
    expect(findNpcForToken({ kind: 'monster', entryId: 'MM__Commoner', name: '老乔' }, [npc])).toBeNull();
  });

  it('keeps a quick-reference target for NPC tokens whose old archive record is missing', () => {
    const fallback = npcQuickReferenceForToken({
      id: 'old-token', kind: 'npc', entryId: 'npc:missing-record', name: '曼松的拟像', hp: { current: 99, max: 126 },
    }, [npc]);
    expect(fallback).toMatchObject({
      id: 'missing-record', name: '曼松的拟像', role: '场景 NPC', groupPath: ['未归档'],
    });
    expect(fallback?.notesMarkdown).toContain('| HP | 99 / 126 |');
    expect(npcQuickReferenceForToken({
      id: 'old-token', kind: 'npc', entryId: 'npc:missing-record', name: '曼松的拟像', hp: { current: 99, max: 126 },
    }, [npc], { allowFallback: false })).toBeNull();
    expect(npcQuickReferenceForToken({
      id: 'monster-token', kind: 'monster', entryId: 'MM__Commoner', name: '平民', hp: undefined,
    }, [npc])).toBeNull();
  });
});
