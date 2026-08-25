import { describe, expect, it } from 'vitest';
import { parseNpcMarkdown } from '../features/npc/markdown';

describe('NPC Markdown archive parser', () => {
  it('imports one front-matter NPC while preserving Markdown notes', () => {
    const [npc] = parseNpcMarkdown(`---
name: 伊蕾娜
aliases: [蓝宝石, 北门信使]
role: 城主顾问
location: 北区
status: missing
importance: major
---
## 动机
正在调查失踪商队。`, 'irena.md');

    expect(npc).toMatchObject({
      name: '伊蕾娜',
      aliases: ['蓝宝石', '北门信使'],
      role: '城主顾问',
      location: '北区',
      status: 'missing',
      importance: 'major',
      sourceFile: 'irena.md',
    });
    expect(npc.notesMarkdown).toContain('正在调查失踪商队');
  });

  it('imports one NPC per H1 and recognizes Chinese labeled fields', () => {
    const records = parseNpcMarkdown(`# 老乔
**身份**：酒馆老板
**地点**：跃马旅店
**状态**：活跃
掌握黑市入口的线索。

# 米拉
- 别名：灰狐、M
- 状态：死亡
曾是盗贼公会联络人。`, 'waterdeep-npcs.md');

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ name: '老乔', role: '酒馆老板', location: '跃马旅店', status: 'active' });
    expect(records[1]).toMatchObject({ name: '米拉', aliases: ['灰狐', 'M'], status: 'dead' });
  });

  it('uses the file name when a note has no heading', () => {
    const [npc] = parseNpcMarkdown('一位没有收录在资料库中的向导。', '荒原向导.md');
    expect(npc.name).toBe('荒原向导');
  });

  it('keeps generic archive sections in one character file', () => {
    const records = parseNpcMarkdown(`# 人物档案
**身份**：曼松的亲信

# 背景
负责经营烟火生意。

# 规则资料
| 护甲等级 | 15 |
| 生命值 | 44 |`, '阿贡·焰火.md');

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: '阿贡·焰火', groupPath: ['未分类'], statReference: { kind: 'custom' } });
    expect(records[0].notesMarkdown).toContain('负责经营烟火生意');
    expect(records[0].notesMarkdown.match(/^## 人物档案$/gmu)).toHaveLength(1);
  });
});
