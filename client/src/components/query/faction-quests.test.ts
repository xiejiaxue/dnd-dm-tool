import { describe, expect, it, vi } from 'vitest';
import book from '../../../../shared/waterdeep/faction-quests.json';
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
});
