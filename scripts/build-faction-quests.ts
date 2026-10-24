// Build shared/waterdeep/faction-quests.json from the DM's local Markdown notes:
//   npx tsx scripts/build-faction-quests.ts "/path/to/深水城龙金劫-跑团知识库/01-主持人整理/派系任务链"
// The source folder is read-only. Links to other local notes are reduced to
// their text, since those files are not part of the app.
import fs from 'node:fs';
import path from 'node:path';
import type { FactionChain, FactionQuest, FactionQuestBook, QuestSection } from '../shared/faction-quests';

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

function buildChain(file: string, meta: typeof CHAINS[string], index: Map<string, { contact: string; goal: string }>): FactionChain {
  const parsed = parse(file);
  const quests: FactionQuest[] = [];
  const sections: QuestSection[] = [];
  let summary: Table | null = null;
  for (const section of parsed.sections) {
    // A chain written as one ### card per quest (the mercenary chain).
    const cards = section.lines.filter(line => /^### 任务[一二三四五六七八九十]+：/.test(line));
    if (cards.length) {
      section.lines.forEach((line, at) => {
        const match = /^### 任务([一二三四五六七八九十]+)：(.+)$/.exec(line);
        if (!match) return;
        const next = section.lines.findIndex((candidate, after) => after > at && candidate.startsWith('### '));
        const code = `${meta.codePrefix ?? 'Q'}${CHINESE_NUMBERS.indexOf(match[1]) + 1}`;
        quests.push({ id: `${meta.id}:${code}`, code, title: match[2].trim(), fields: [], body: toMarkdown(section.lines.slice(at + 1, next < 0 ? undefined : next)) });
      });
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
  // Card-style chains list outcome, pay and outposts in a summary table; attach them to the cards.
  if (summary) {
    const titleColumn = summary.header.indexOf('任务');
    for (const quest of quests.filter(item => item.body)) {
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
