import { describe, expect, it } from 'vitest';
import type { NpcRecord } from '../types';
import { buildNpcTree, formatCustomNpc, searchNpcs } from '../features/npc/model';
import {
  consolidateNpcRecords,
  deriveNpcStatReference,
  expandNpcRecord,
  normalizeNpcMetadata,
  npcInitiativeModifier,
  npcMaximumHitPoints,
  resolveNpcInitiativeSource,
} from '../../../shared/npc-metadata';

function npc(overrides: Partial<NpcRecord>): NpcRecord {
  return {
    id: 'npc', name: '测试 NPC', aliases: [], role: '', location: '', status: 'active',
    notesMarkdown: '', sourceFile: null, updatedAt: 0, ...overrides,
  };
}

describe('NPC campaign model', () => {
  it('builds exactly faction -> person and sorts people by importance', () => {
    const tree = buildNpcTree([
      npc({ id: 'two', name: '达维尔', importance: 'supporting', faction: '散塔林会', groupPath: ['散塔林会', '厄运掠夺者'] }),
      npc({ id: 'one', name: '曼松', importance: 'major', faction: '散塔林会', groupPath: ['散塔林会', '曼松派'] }),
      npc({ id: 'three', name: '珊娜萨', importance: 'major', faction: '珊娜萨公会', groupPath: ['珊娜萨公会'] }),
    ]);
    expect(tree).toHaveLength(2);
    const zhentarim = tree.find(node => node.type === 'folder' && node.name === '散塔林会');
    expect(zhentarim).toMatchObject({ type: 'folder', name: '散塔林会', count: 2 });
    if (zhentarim?.type === 'folder') expect(zhentarim.children.map(child => child.type === 'npc' ? child.npc.name : '')).toEqual(['曼松', '达维尔']);
    expect(tree.flatMap(node => node.type === 'folder' ? node.children : []).every(child => child.type === 'npc')).toBe(true);
  });

  it('searches faction paths and formats module-specific stat tables', () => {
    const record = npc({
      name: '黑杖', faction: '灰手', groupPath: ['深水城', '灰手'],
      notesMarkdown: '**中型类人生物，守序善良**\n\n| 属性 | 数值 |\n|---|---|\n| 护甲等级 | 17 |\n| 生命值 | 126（23d8+23） |\n\n**动作**：施放法术。',
    });
    expect(searchNpcs([record], '灰手')).toHaveLength(1);
    expect(formatCustomNpc(record)).toMatchObject({ meta: '中型类人生物，守序善良', rows: [['护甲等级', '17'], ['生命值', '126（23d8+23）']] });
    expect(npcMaximumHitPoints(record.notesMarkdown)).toBe(126);
    expect(npcInitiativeModifier('| 力量/敏捷/体质 | 12（+1）/ 16（+3）/ 14（+2） |')).toBe(3);
    expect(deriveNpcStatReference(record)).toEqual({ kind: 'custom' });
  });

  it('resolves NPC initiative from linked compendium data or custom Dexterity', () => {
    const linked = npc({
      id: 'linked',
      statReference: { kind: 'compendium', entryId: 'MM__Veteran', nameZh: '老兵', nameEn: 'Veteran' },
    });
    const alias = npc({ id: 'alias', statReference: { kind: 'npc', npcId: 'linked', name: '老兵模板' } });
    const custom = npc({
      id: 'custom',
      statReference: { kind: 'custom' },
      notesMarkdown: '| 护甲等级 | 16 |\n| 生命值 | 40 |\n| 敏捷 | 18（+4） |',
    });
    expect(resolveNpcInitiativeSource(alias, [linked, alias])).toEqual({ entryId: 'MM__Veteran' });
    expect(resolveNpcInitiativeSource(custom, [custom])).toEqual({ entryId: null, modifier: 4 });
  });

  it('expands aggregate notes and derives Monster Manual references for old rooms', () => {
    const aggregate = npc({
      id: 'other', name: '其他成员', role: '珊娜萨公会', sourceFile: '01-珊娜萨公会/14-其他成员.md',
      notesMarkdown: '## 泽姆克 Zemk\n**身份**：灰矮人守卫\n\n## 希尔加 Sylgar\n**身份**：宠物鱼',
    });
    const expanded = expandNpcRecord(aggregate);
    expect(expanded.map(item => item.name)).toEqual(['泽姆克', '希尔加']);
    expect(expanded[0]).toMatchObject({ faction: '珊娜萨公会', groupPath: ['珊娜萨公会'] });
    expect(expanded[1].statReference).toMatchObject({ kind: 'compendium', entryId: 'MM__Quipper' });
    expect(normalizeNpcMetadata(npc({ role: '珊娜萨公会', sourceFile: '01-珊娜萨公会/01.md', notesMarkdown: '**身份**：公会首领' })).role).toBe('公会首领');
  });

  it('merges legacy section files into one canonical character record', () => {
    const fragments = [
      npc({ id: 'profile', name: '人物档案', faction: '散塔林会', groupPath: ['散塔林会', '曼松', '阿贡·焰火'], role: '曼松的亲信', notesMarkdown: '**身份**：曼松的亲信' }),
      npc({ id: 'background', name: '背景', faction: '散塔林会', groupPath: ['散塔林会', '曼松', '阿贡·焰火'], notesMarkdown: '负责城内的烟火生意。' }),
      npc({ id: 'rules', name: '规则资料', faction: '散塔林会', groupPath: ['散塔林会', '曼松', '阿贡·焰火'], notesMarkdown: '| 护甲等级 | 15 |\n| 生命值 | 44 |' }),
    ];
    const result = consolidateNpcRecords(fragments);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ name: '阿贡·焰火', faction: '散塔林会', groupPath: ['散塔林会'], statReference: { kind: 'custom' } });
    expect(result.records[0].notesMarkdown).toContain('负责城内的烟火生意');
    expect(result.records[0].notesMarkdown.match(/^## 人物档案$/gmu)).toHaveLength(1);
    expect([...result.idRemap.values()]).toEqual([result.records[0].id, result.records[0].id, result.records[0].id]);
  });
});
