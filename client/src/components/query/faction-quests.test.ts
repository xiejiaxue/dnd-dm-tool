import { describe, expect, it, vi } from 'vitest';
import book from '../../../../shared/waterdeep/faction-quests.json';
import npcs from '../../../../shared/waterdeep/index.json';
import type { FactionQuestBook } from '../../../../shared/faction-quests';
import type { Campaign } from '../../types';
import { chainProgress, questStatus, searchQuests } from './FactionQuests';

vi.mock('../../ws', () => ({ connection: { sendOps: vi.fn() } }));
const data = book as FactionQuestBook;
const campaign = { id: 'c', name: 'c', sceneIds: [], enemies: [], questProgress: { 'harpers:H1': 'done', 'harpers:H2': 'active' } } as Campaign;

describe('faction quest helpers', () => {
  it('reads progress per chain, defaulting to open', () => {
    const harpers = data.chains.find(chain => chain.id === 'harpers')!;
    expect(chainProgress(campaign, harpers)).toEqual({ total: 4, done: 1, active: 1 });
    expect(questStatus(campaign, 'harpers:H3')).toBe('open');
    expect(questStatus(null, 'harpers:H1')).toBe('open');
  });

  it('finds quests by every word across code, title and fields', () => {
    expect(searchQuests(data, 'H1').map(hit => hit.quest.id)).toContain('harpers:H1');
    expect(searchQuests(data, '竖琴手 车马').map(hit => hit.quest.id)).toEqual(['harpers:H1']);
    expect(searchQuests(data, '   ')).toEqual([]);
  });

  it('keeps every quest id unique and every faction chain non-empty', () => {
    const ids = data.chains.flatMap(chain => chain.quests.map(quest => quest.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const chain of data.chains.filter(item => item.kind === 'faction')) expect(chain.quests.length).toBeGreaterThan(0);
  });

  it('gives every quest card a level, and every placeable enemy a known stat card', () => {
    const npcIds = new Set(npcs.map(npc => npc.id));
    for (const quest of data.chains.flatMap(chain => chain.quests)) {
      expect(quest.level, quest.id).toBeGreaterThan(0);
      for (const enemy of (quest.encounters ?? []).flatMap(encounter => encounter.enemies)) {
        expect(enemy.count, `${quest.id} ${enemy.name}`).toBeGreaterThan(0);
        if (!enemy.entryId) continue;
        if (enemy.entryId.startsWith('WDNPC__')) expect(npcIds.has(enemy.entryId), `${quest.id} ${enemy.name}`).toBe(true);
        else expect(enemy.entryId, `${quest.id} ${enemy.name}`).toMatch(/^(MM|VGM|WDH)__\S/);
      }
    }
  });
});
