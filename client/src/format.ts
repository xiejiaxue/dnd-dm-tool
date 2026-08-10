import type { EntryType } from './types';

export function renderMarkup(s: string): string {
  return s
    .replace(/\{@([a-z]+)\s+([^}]*)\}/g, (_m, tag: string, inner: string) => {
      const t = inner.trim().split('|')[0];
      if (tag === 'atk') {
        if (t.includes('mw')) return '近战武器攻击';
        if (t.includes('rw')) return '远程武器攻击';
        return '';
      }
      return t;
    })
    .replace(/\{@([a-z]+)\}/g, (_m, tag: string) => (tag === 'h' ? '命中' : ''))
    .replace(/\{\{([^}]+)\}\}/g, '$1');
}

export interface StatBlock {
  name: string;
  meta: string;                 // 单行摘要，如 "小型 类人生物，CR 1/4"
  rows: [string, string][];     // 属性行
  body: string[];               // 段落/条目
}

const SIZE_ZH: Record<string, string> = { T: '微型', S: '小型', M: '中型', L: '大型', H: '巨型', G: '超巨型' };
const SCHOOL_ZH: Record<string, string> = { V: '塑能', A: '防护', E: '惑控', C: '变化', D: '预言', I: '幻术', N: '死灵', T: '咒法', M: '创造' };
const TYPE_ZH: Record<string, string> = {
  humanoid: '类人生物', aberration: '异怪', monstrosity: '怪兽', dragon: '龙类',
  undead: '亡灵', elemental: '元素', beast: '野兽', construct: '构装体',
  fiend: '邪魔', plant: '植物', ooze: '泥怪', fey: '精类', giant: '巨人', celestial: '天界生物',
};
const SPEED_ZH: Record<string, string> = { walk: '步行', burrow: '掘地', climb: '攀爬', fly: '飞行', swim: '游泳' };
const ALIGN_ZH: Record<string, string> = {
  LG: '守序善良', LN: '守序中立', LE: '守序邪恶',
  NG: '中立善良', NN: '绝对中立', NE: '中立邪恶',
  CG: '混乱善良', CN: '混乱中立', CE: '混乱邪恶',
  U: '无阵营', A: '任意阵营', NX: '任何非善良', NY: '任何非邪恶',
};

const TIME_UNIT_ZH: Record<string, string> = { action: '动作', bonus: '附赠动作', reaction: '反应', minute: '分钟', hour: '小时' };
const DUR_UNIT_ZH: Record<string, string> = { hour: '小时', minute: '分钟', day: '天', round: '回合' };
const DUR_TYPE_ZH: Record<string, string> = { instant: '瞬间', permanent: '永久', special: '特殊' };
const RANGE_ZH: Record<string, string> = { touch: '触及', sight: '视线', unlimited: '无限', self: '自身' };

function fmtAlignment(a: unknown): string {
  if (!a) return '';
  if (Array.isArray(a)) {
    if (a.length === 2) return ALIGN_ZH[a.join('') as keyof typeof ALIGN_ZH] ?? a.join(' ');
    return a.map((x) => ALIGN_ZH[String(x) as keyof typeof ALIGN_ZH] ?? x).join(' ');
  }
  if (typeof a === 'object' && a !== null && Array.isArray((a as { alignment?: unknown }).alignment)) {
    return fmtAlignment((a as { alignment: unknown }).alignment);
  }
  return ALIGN_ZH[String(a) as keyof typeof ALIGN_ZH] ?? String(a);
}

function fmtAc(ac: unknown): string {
  if (Array.isArray(ac)) {
    const first = ac[0];
    if (typeof first === 'object' && first != null) return String((first as { ac?: unknown }).ac ?? '');
    return String(first ?? '');
  }
  return String(ac ?? '');
}

function fmtSpeed(speed: unknown): string {
  if (!speed) return '';
  if (typeof speed === 'string') return speed;
  return Object.entries(speed as Record<string, unknown>)
    .filter(([k]) => SPEED_ZH[k])
    .map(([k, v]) => {
      const zh = SPEED_ZH[k] ?? k;
      let num: number | undefined;
      let cond = '';
      if (typeof v === 'number') num = v;
      else if (typeof v === 'object' && v != null) {
        const o = v as { number?: unknown; condition?: unknown };
        num = typeof o.number === 'number' ? o.number : undefined;
        if (o.condition) cond = String(o.condition);
      }
      if (num == null || num === 0) return '';
      return `${zh} ${num}${cond}`;
    })
    .filter(Boolean)
    .join('，');
}

function fmtLanguages(lang: unknown): string {
  if (!lang) return '';
  if (Array.isArray(lang)) return lang.join('、');
  return String(lang);
}

export function formatMonster(m: any): StatBlock {
  const size = SIZE_ZH[String(m.size?.[0])] ?? m.size?.[0] ?? '';
  const type = TYPE_ZH[m.type?.type ?? m.type] ?? m.type?.type ?? (typeof m.type === 'string' ? m.type : '');
  const body = [
    ...(m.trait ?? []).map((t: any) => `**${t.name}。** ${(t.entries ?? []).map(renderMarkup).join(' ')}`),
    ...(m.action ?? []).map((a: any) => `**${a.name}。** ${(a.entries ?? []).map(renderMarkup).join(' ')}`),
  ];
  return {
    name: m.name,
    meta: [size, type, fmtAlignment(m.alignment), m.cr != null ? `CR ${m.cr}` : ''].filter(Boolean).join('，'),
    rows: [
      ['AC', fmtAc(m.ac)],
      ['HP', m.hp ? `${m.hp.average ?? ''}（${m.hp.formula ?? ''}）` : ''],
      ['速度', fmtSpeed(m.speed)],
      ['力量', String(m.str ?? '')], ['敏捷', String(m.dex ?? '')], ['体质', String(m.con ?? '')],
      ['智力', String(m.int ?? '')], ['感知', String(m.wis ?? '')], ['魅力', String(m.cha ?? '')],
      ['语言', fmtLanguages(m.languages)],
    ].filter(([, v]) => v) as [string, string][],
    body,
  };
}

function fmtDuration(d: any): string {
  const conc = d?.concentration ? '专注，' : '';
  if (d?.type === 'timed' && d.duration) {
    const unit = DUR_UNIT_ZH[d.duration.type] ?? d.duration.type;
    return `${conc}${d.duration.amount ?? ''} ${unit}`.trim();
  }
  return `${conc}${DUR_TYPE_ZH[d?.type] ?? d?.type ?? ''}`.trim();
}

function fmtRange(r: any): string {
  const dist = r?.distance;
  if (dist?.amount != null) {
    const unit = dist.type === 'miles' ? '英里' : '尺';
    return `${dist.amount} ${unit}`;
  }
  if (r?.type === 'special') return '特殊';
  return RANGE_ZH[dist?.type ?? r?.type] ?? dist?.type ?? r?.type ?? '';
}

export function formatSpell(s: any): StatBlock {
  const time = (s.time ?? []).map((t: any) => `${t.number ?? 1} ${TIME_UNIT_ZH[t.unit] ?? t.unit ?? ''}`).join(' 或 ');
  const m = s.components?.m;
  const mText = typeof m === 'string' ? m : (m?.text ?? '');
  const comp = [
    s.components?.v ? 'V' : '', s.components?.s ? 'S' : '', m ? `M（${mText}）` : '',
  ].filter(Boolean).join(', ');
  const dur = (s.duration ?? []).map(fmtDuration).filter(Boolean).join(' 或 ');
  return {
    name: s.name,
    meta: `${s.level === 0 ? '戏法' : `${s.level} 环`} ${SCHOOL_ZH[s.school] ?? s.school}，${time}`,
    rows: [
      ['施法距离', fmtRange(s.range)],
      ['成分', comp],
      ['持续时间', dur],
    ].filter(([, v]) => v) as [string, string][],
    body: (s.entries ?? []).map(renderMarkup),
  };
}

/**
 * Monster and spell records have dedicated stat blocks. Other 5etools record
 * kinds still deserve a readable drawer when they arrive from the online
 * fallback, rather than being incorrectly rendered as a spell.
 */
export function formatCompendiumEntry(type: EntryType, entry: any): StatBlock {
  if (type === 'monster') return formatMonster(entry);
  if (type === 'spell') return formatSpell(entry);

  const kind = type === 'item' ? '装备' : type === 'feat' ? '专长' : '状态';
  const source = typeof entry.source === 'string' ? entry.source : '';
  const page = typeof entry.page === 'number' ? `第 ${entry.page} 页` : '';
  return {
    name: typeof entry.name === 'string' ? entry.name : kind,
    meta: [kind, source, page].filter(Boolean).join(' · '),
    rows: [
      ['来源', source],
      ['稀有度', typeof entry.rarity === 'string' ? entry.rarity : ''],
      ['类别', typeof entry.type === 'string' ? entry.type : ''],
    ].filter(([, value]) => value) as [string, string][],
    body: flattenCompendiumEntries(entry.entries),
  };
}

function flattenCompendiumEntries(value: unknown): string[] {
  if (typeof value === 'string') return [renderMarkup(value)];
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) => {
    if (typeof part === 'string') return [renderMarkup(part)];
    if (typeof part !== 'object' || part === null) return [];
    const record = part as { name?: unknown; entries?: unknown };
    const nested = flattenCompendiumEntries(record.entries);
    const title = typeof record.name === 'string' ? renderMarkup(record.name) : '';
    if (!title) return nested;
    return nested.length ? [`**${title}。** ${nested.join(' ')}`] : [`**${title}。**`];
  });
}
