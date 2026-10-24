// Build shared/waterdeep/faction-quests.json from the DM's local Markdown notes:
//   npx tsx scripts/build-faction-quests.ts "/path/to/深水城龙金劫-跑团知识库/01-主持人整理/派系任务链"
// The source folder is read-only. Links to other local notes are reduced to
// their text, since those files are not part of the app.
import fs from 'node:fs';
import path from 'node:path';
import type { FactionChain, FactionQuest, FactionQuestBook, QuestCheck, QuestEncounter, QuestEnemy, QuestSection } from '../shared/faction-quests';

// File number → stable id, kind and the faction name used by shared/waterdeep/index.json.
const CHAINS: Record<string, { id: string; kind: FactionChain['kind']; npcFaction?: string; codePrefix?: string }> = {
  '01': { id: 'bregan-daerthe', kind: 'faction', npcFaction: '布雷根·达瑟与海洋少女嘉年华', codePrefix: 'B' },
  '02': { id: 'harpers', kind: 'faction', npcFaction: '竖琴手同盟' },
  '03': { id: 'gray-hands', kind: 'faction', npcFaction: '灰手与黑杖塔' },
  '04': { id: 'lords-alliance', kind: 'faction', npcFaction: '深水城政府与领主联盟' },
  '05': { id: 'order-of-the-gauntlet', kind: 'faction', npcFaction: '铁手教团与公正之手' },
  '06': { id: 'emerald-enclave', kind: 'faction', npcFaction: '翠绿闲庭' },
  '07': { id: 'doom-raiders', kind: 'faction', npcFaction: '厄运掠夺者' },
  '08': { id: 'cassalanter', kind: 'faction', npcFaction: '卡萨兰特家族与阿斯蒙蒂斯邪教' },
  '09': { id: 'xanathar', kind: 'faction', npcFaction: '珊娜萨公会' },
  '10': { id: 'manshoon', kind: 'faction', npcFaction: '曼松散塔林会' },
  '11': { id: 'gralhund', kind: 'faction', npcFaction: '格拉汉德家族' },
  '12': { id: 'black-viper', kind: 'ally' },
  '13': { id: 'bonnie', kind: 'ally' },
};
const CHINESE_NUMBERS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const source = process.argv[2];
if (!source || !fs.existsSync(path.join(source, 'README.md'))) {
  console.error('Usage: npx tsx scripts/build-faction-quests.ts <派系任务链 folder>');
  process.exit(1);
}
const output = path.resolve('shared/waterdeep/faction-quests.json');
// Named Waterdeep NPCs are written as 深水城:姓名 in encounter tables and resolved to their card ids.
const npcIds = new Map<string, string>((JSON.parse(fs.readFileSync(path.resolve('shared/waterdeep/index.json'), 'utf8')) as { id: string; nameZh: string }[]).map(npc => [npc.nameZh, npc.id]));

const read = (file: string) => fs.readFileSync(path.join(source, file), 'utf8').replace(/\r\n/g, '\n');
const unlink = (text: string) => text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
const isNavigation = (line: string) => /^\[返回总索引\]/.test(line.trim());

interface Table { header: string[]; rows: string[][]; start: number; end: number }
const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

/** Markdown tables in a block of lines, with their line ranges. */
function tables(lines: string[]): Table[] {
  const found: Table[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) continue;
    let end = i + 2;
    while (end < lines.length && lines[end].trim().startsWith('|')) end += 1;
    found.push({ header: cells(lines[i]), rows: lines.slice(i + 2, end).map(cells), start: i, end });
    i = end;
  }
  return found;
}

interface ParsedFile { title: string; tagline: string; notes: string[]; sections: { heading: string; lines: string[] }[] }

function parse(file: string): ParsedFile {
  const lines = read(file).split('\n').filter(line => !isNavigation(line));
  const titleLine = lines.find(line => line.startsWith('# ')) ?? '# ';
  const [title, ...rest] = titleLine.slice(2).trim().split('：');
  const body = lines.slice(lines.indexOf(titleLine) + 1);
  const notes: string[] = [];
  let index = 0;
  while (index < body.length && (body[index].trim() === '' || body[index].startsWith('>'))) {
    if (body[index].startsWith('>')) notes.push(unlink(body[index].replace(/^>\s?/, '')));
    index += 1;
  }
  const sections: ParsedFile['sections'] = [];
  let current: ParsedFile['sections'][number] | null = null;
  for (const line of body.slice(index)) {
    if (line.startsWith('## ')) {
      current = { heading: line.slice(3).trim(), lines: [] };
      sections.push(current);
    } else {
      // Text before the first ## (independent allies) becomes an untitled lead section.
      if (!current) { current = { heading: '', lines: [] }; sections.push(current); }
      current.lines.push(line);
    }
  }
  return { title: title.trim(), tagline: rest.join('：').trim(), notes, sections };
}

const toMarkdown = (lines: string[]) => unlink(lines.join('\n')).replace(/\n{3,}/g, '\n\n').trim();
const sectionHeading = (heading: string) => (heading || '合作方式').replace(/^\d+\.\s*/, '').replace(/^来源与改编依据：来源与改编记录$/, '来源与改编');

/** A quest table: its first column holds codes such as H1 or C3 followed by a title. */
function questTable(table: Table, factionId: string): FactionQuest[] | null {
  const parsed = table.rows.map(row => /^([A-Z]\d+)\s+(.+)$/.exec(row[0] ?? ''));
  if (!parsed.length || parsed.some(match => !match)) return null;
  return parsed.map((match, row) => ({
    id: `${factionId}:${match![1]}`,
    code: match![1],
    title: unlink(match![2]).trim(),
    fields: table.header.slice(1).map((label, column) => ({ label, text: unlink(table.rows[row][column + 1] ?? '') })),
  }));
}

function statCard(cell: string, where: string): string | undefined {
  const value = cell.trim();
  if (!value || value === '—' || value === '-') return undefined;
  if (value.startsWith('深水城:')) {
    const id = npcIds.get(value.slice(4));
    if (!id) throw new Error(`${where}: unknown Waterdeep NPC ${value}`);
    return id;
  }
  if (!/^[A-Za-z]+__\S.*$/.test(value)) throw new Error(`${where}: stat card must be SOURCE__Name or 深水城:姓名, got ${value}`);
  return value;
}

/**
 * Pull the structured parts out of a quest card: **建议等级：** N, the 检定 table
 * and any number of 战斗[：标题] tables. The rest of the card stays as Markdown.
 */
function readCard(lines: string[], quest: FactionQuest): FactionQuest {
  const where = quest.id;
  const before: string[] = [];
  const after: string[] = [];
  const checks: QuestCheck[] = [];
  const encounters: QuestEncounter[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const heading = /^####\s+(检定|战斗)(?:[：:]\s*(.+))?$/.exec(lines[at].trim());
    if (!heading) {
      // The level becomes a badge in the app, so drop it from the prose.
      const level = /\*\*建议等级：\*\*\s*(\d+)[\s　]*/.exec(lines[at]);
      if (level && quest.level === undefined) quest.level = Number(level[1]);
      const line = level ? lines[at].replace(level[0], '') : lines[at];
      if (!level || line.trim()) (checks.length || encounters.length ? after : before).push(line);
      continue;
    }
    // The table follows the heading (blank lines allowed); it ends at the first non-table line.
    let start = at + 1;
    while (start < lines.length && !lines[start].trim()) start += 1;
    const [table] = tables(lines.slice(start));
    if (!table || table.start !== 0) throw new Error(`${where}: #### ${heading[1]} has no table`);
    at = start + table.end - 1;
    const column = (label: string) => {
      const index = table.header.indexOf(label);
      if (index < 0) throw new Error(`${where}: ${heading[1]} table lacks column ${label}`);
      return index;
    };
    if (heading[1] === '检定') {
      const [situation, check, dc, success, failure] = ['情境', '检定', 'DC', '成功', '失败'].map(column);
      for (const row of table.rows) checks.push({ situation: unlink(row[situation]), check: unlink(row[check]), dc: row[dc], success: unlink(row[success]), failure: unlink(row[failure]) });
    } else {
      const [name, count, cr, card, notes] = ['敌人', '数量', 'CR', '数据卡', '位置与战术'].map(column);
      const enemies: QuestEnemy[] = table.rows.map(row => {
        const number = Number(row[count]);
        if (!Number.isInteger(number) || number < 1) throw new Error(`${where}: bad count ${row[count]}`);
        const entryId = statCard(row[card], where);
        return { name: unlink(row[name]), count: number, cr: row[cr], ...(entryId ? { entryId } : {}), notes: unlink(row[notes]) };
      });
      encounters.push({ title: heading[2]?.trim() || '遭遇', enemies });
    }
  }
  return {
    ...quest,
    body: toMarkdown(before),
    ...(toMarkdown(after) ? { outcome: toMarkdown(after) } : {}),
    ...(checks.length ? { checks } : {}),
    ...(encounters.length ? { encounters } : {}),
  };
}

function buildChain(file: string, meta: typeof CHAINS[string], index: Map<string, { contact: string; goal: string }>): FactionChain {
  const parsed = parse(file);
  const quests: FactionQuest[] = [];
  const sections: QuestSection[] = [];
  let summary: Table | null = null;
  // Cards: "### 任务一：标题" (mercenary chain) or "### H1 标题" (the 任务卡 section).
  const cardTitle = (line: string): { code: string; title: string } | null => {
    const numbered = /^### 任务([一二三四五六七八九十]+)：(.+)$/.exec(line);
    if (numbered) return { code: `${meta.codePrefix ?? 'Q'}${CHINESE_NUMBERS.indexOf(numbered[1]) + 1}`, title: numbered[2].trim() };
    const coded = /^### ([A-Z]\d+)\s+(.+)$/.exec(line);
    return coded ? { code: coded[1], title: coded[2].trim() } : null;
  };
  const cards: { code: string; title: string; lines: string[] }[] = [];
  let questNote: string | undefined;
  for (const section of parsed.sections) {
    if (section.lines.some(line => cardTitle(line))) {
      const before: string[] = [];
      section.lines.forEach((line, at) => {
        const title = cardTitle(line);
        if (!title) { if (!section.lines.slice(0, at).some(previous => cardTitle(previous))) before.push(line); return; }
        const next = section.lines.findIndex((candidate, after) => after > at && candidate.startsWith('### '));
        cards.push({ ...title, lines: section.lines.slice(at + 1, next < 0 ? undefined : next) });
      });
      const lead = toMarkdown(before);
      if (section.heading === '任务卡（带团用）') questNote = lead.replace(/^>\s?/gm, '') || undefined;
      else if (lead) sections.push({ heading: sectionHeading(section.heading), markdown: lead });
      continue;
    }
    const lines = [...section.lines];
    for (const table of tables(lines).reverse()) {
      const found = questTable(table, meta.id);
      if (found) {
        quests.unshift(...found);
        lines.splice(table.start, table.end - table.start);
      } else if (table.header.includes('任务') && table.header.includes('基础总报酬')) {
        summary = table;
      }
    }
    const markdown = toMarkdown(lines);
    if (markdown) sections.push({ heading: sectionHeading(section.heading), markdown });
  }
  // Merge each card into the quest of the same code from the quest table, or add it.
  for (const card of cards) {
    const id = `${meta.id}:${card.code}`;
    const index = quests.findIndex(quest => quest.id === id);
    const base: FactionQuest = index >= 0 ? quests[index] : { id, code: card.code, title: card.title, fields: [] };
    const quest = readCard(card.lines, base);
    if (index >= 0) quests[index] = quest; else quests.push(quest);
  }
  // Card-style chains list outcome, pay and outposts in a summary table; attach them to the cards.
  if (summary) {
    const titleColumn = summary.header.indexOf('任务');
    for (const quest of quests.filter(item => item.fields.length === 0)) {
      const row = summary.rows.find(candidate => candidate[titleColumn] === quest.title);
      if (row) quest.fields = summary.header.map((label, column) => ({ label, text: unlink(row[column]) })).filter((_, column) => column !== titleColumn && summary!.header[column] !== '顺序参考');
    }
  }
  const listed = index.get(file);
  return {
    id: meta.id,
    kind: meta.kind,
    name: parsed.title,
    tagline: parsed.tagline,
    ...(listed?.contact ? { contact: listed.contact } : {}),
    ...(listed?.goal ? { goal: listed.goal } : {}),
    ...(meta.npcFaction ? { npcFaction: meta.npcFaction } : {}),
    notes: parsed.notes,
    ...(questNote ? { questNote } : {}),
    quests,
    sections,
  };
}

// README: contact and goal per faction file, plus the "how to use at the table" steps.
const readme = read('README.md').split('\n');
const index = new Map<string, { contact: string; goal: string }>();
for (const table of tables(readme)) {
  for (const row of table.rows) {
    const file = /\]\(([^)]+\.md)\)/.exec(row[0] ?? '')?.[1];
    if (file) index.set(file, { contact: unlink(row[1] ?? ''), goal: unlink(row[2] ?? '') });
  }
}
// Independent allies are a bullet list: "- [名称](12-黑蝰蛇.md)：送药事件、身份与潜入合作。"
for (const line of readme) {
  const match = /^-\s*\[[^\]]+\]\((\d\d-[^)]+\.md)\)：(.+)$/.exec(line.trim());
  if (match && !index.has(match[1])) index.set(match[1], { contact: '', goal: unlink(match[2]).replace(/。$/, '') });
}
const readmeSections = parse('README.md').sections;
const howTo = readmeSections.find(section => section.heading === '跑团时怎么查');

const shared = parse('00-共用规则与主持人记录.md');
const overview: QuestSection[] = [
  ...(howTo ? [{ heading: '跑团时怎么查', markdown: toMarkdown(howTo.lines) }] : []),
  ...shared.sections.map(section => ({ heading: sectionHeading(section.heading), markdown: toMarkdown(section.lines) })).filter(section => section.markdown),
];

const files = fs.readdirSync(source).filter(file => /^\d\d-.+\.md$/.test(file) && file.slice(0, 2) in CHAINS).sort();
const book: FactionQuestBook = {
  title: '深水城：龙金劫 · 派系任务链',
  overview,
  chains: files.map(file => buildChain(file, CHAINS[file.slice(0, 2)], index)),
};
const missing = Object.keys(CHAINS).filter(number => !files.some(file => file.startsWith(number)));
if (missing.length) throw new Error(`Missing chain files: ${missing.join(', ')}`);
for (const chain of book.chains)
  if (chain.kind === 'faction' && chain.quests.length === 0) throw new Error(`${chain.name}: no quests parsed`);
const ids = book.chains.flatMap(chain => chain.quests.map(quest => quest.id));
if (new Set(ids).size !== ids.length) throw new Error('Duplicate quest ids');

fs.writeFileSync(output, `${JSON.stringify(book, null, 1)}\n`);
console.log(`Wrote ${path.relative(process.cwd(), output)}: ${book.chains.length} chains, ${ids.length} quests, ${overview.length} overview sections`);
