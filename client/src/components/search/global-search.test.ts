import { describe, expect, it } from 'vitest';
import type { CampaignJournal } from '../../api';
import type { IndexEntry } from '../../types';
import { entryHits, journalHits, noteHits, orderHits, queryWords, sceneHits, snippet } from './global-search';

const journal = (id: string, title: string, content: string): CampaignJournal => ({ id, title, content, visibility: 'dm', updatedAt: 0 });

describe('global search', () => {
  it('splits the query into lower-case words', () => {
    expect(queryWords('  Goblin  老鼠 ')).toEqual(['goblin', '老鼠']);
  });

  it('cuts a one-line snippet around the first match', () => {
    const text = `${'前'.repeat(60)}\n关键线索在这里${'后'.repeat(100)}`;
    const line = snippet(text, ['线索'], 10);
    expect(line.startsWith('…')).toBe(true);
    expect(line.endsWith('…')).toBe(true);
    expect(line).toContain('关键线索');
    expect(line).not.toContain('\n');
    expect(snippet('短文本', ['无'])).toBe('短文本');
  });

  it('matches journals on every word and puts title matches first', () => {
    const hits = journalHits([
      journal('a', '第三次团', '在码头遇到了扎尔·乌尔贝'),
      journal('b', '扎尔线索', '码头的仓库'),
      journal('c', '无关', '酒馆'),
    ], queryWords('扎尔 码头'));
    expect(hits.map(hit => hit.key)).toEqual(['journal:b', 'journal:a']);
    expect(hits[0]).toMatchObject({ kind: 'journal', journalId: 'b', badge: '仅 DM' });
    expect(journalHits([journal('a', '标题', '内容')], [])).toEqual([]);
  });

  it('matches scenes by name', () => {
    const hits = sceneHits([{ id: '1', name: '01 · 克拉摩窝点' }, { id: '2', name: '02 · 凡达林镇' }], queryWords('窝点'));
    expect(hits).toEqual([expect.objectContaining({ kind: 'scene', sceneId: '1' })]);
  });

  it('labels compendium entries by type and keeps the server order', () => {
    const entries: IndexEntry[] = [
      { type: 'monster', id: 'MM__Goblin', nameZh: '地精', nameEn: 'Goblin', source: 'MM', bookFile: '', cr: '1/4' },
      { type: 'spell', id: 'PHB__Fireball', nameZh: '火球术', nameEn: 'Fireball', source: 'PHB', bookFile: '', level: 3 },
      { type: 'condition', id: 'PHB__Grappled', nameZh: '受擒', nameEn: 'Grappled', source: 'PHB', bookFile: '' },
    ];
    expect(entryHits(entries).map(hit => hit.badge)).toEqual(['CR 1/4', '3 环', '状态']);
  });

  it('orders hits by group so arrow keys follow the drawn list', () => {
    const notes = noteHits([{ id: 's:1', kind: 'area', sceneId: 's', sceneName: '01 · 窝点', title: '1. 洞口', text: '洞口有地精' }], ['地精']);
    const hits = orderHits([
      ...entryHits([{ type: 'monster', id: 'MM__Goblin', nameZh: '地精', nameEn: 'Goblin', source: 'MM', bookFile: '' }]),
      ...journalHits([journal('j', '地精', '')], ['地精']),
      ...notes,
    ], ['地精']);
    // The card and journal are titled 地精; the note only mentions it, so it drops to the end.
    expect(hits.map(hit => hit.kind)).toEqual(['journal', 'entry', 'note']);
    expect(orderHits(hits, ['洞口']).map(hit => hit.kind)).toEqual(['note', 'journal', 'entry']);
    expect(notes[0]).toMatchObject({ badge: '区域', subtitle: '01 · 窝点 · 洞口有地精' });
  });
});
