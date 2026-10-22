import type { StatBlock } from './format';
import { ENTRY_KIND_ZH } from './format';
import type { EntryType } from './types';

/**
 * Character-sheet PDF export. The sheet is composed as a standalone A4 print
 * document and handed to the browser's print engine — that keeps Chinese text
 * as selectable vectors and the layout under CSS control, without shipping a
 * CJK font inside a PDF library. "另存为 PDF" in the print dialog produces the
 * file (the document title becomes the suggested filename).
 */

export interface SheetEntryBlock extends StatBlock {
  type: EntryType;
  source: string;
}

export interface CharacterSheetDocument {
  name: string;
  color: string;
  maxHp: number;
  blocks: SheetEntryBlock[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Stat-block body lines use **bold** markup from the compendium formatter. */
function richText(value: string): string {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

const TYPE_ORDER: EntryType[] = [
  'race', 'subrace', 'class', 'subclass', 'classFeature', 'subclassFeature',
  'background', 'feat', 'optionalFeature', 'item', 'spell', 'action', 'condition',
  'language', 'vehicle', 'reward', 'monster',
];

function groupBlocks(blocks: SheetEntryBlock[]): { type: EntryType; label: string; blocks: SheetEntryBlock[] }[] {
  const byType = new Map<EntryType, SheetEntryBlock[]>();
  for (const block of blocks) {
    const list = byType.get(block.type) ?? [];
    list.push(block);
    byType.set(block.type, list);
  }
  return [...byType.keys()]
    .sort((a, b) => TYPE_ORDER.indexOf(a) - TYPE_ORDER.indexOf(b))
    .map(type => ({ type, label: ENTRY_KIND_ZH[type] ?? type, blocks: byType.get(type)! }));
}

function entryHtml(block: SheetEntryBlock): string {
  const rows = block.rows
    .map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${richText(v)}</td></tr>`)
    .join('');
  const body = block.body.map(p => `<p>${richText(p)}</p>`).join('');
  return `
    <article class="entry">
      <h3>${escapeHtml(block.name)}</h3>
      ${block.meta ? `<p class="meta">${escapeHtml(block.meta)}</p>` : ''}
      ${rows ? `<table>${rows}</table>` : ''}
      ${body ? `<div class="body">${body}</div>` : ''}
    </article>`;
}

export function buildSheetHtml(doc: CharacterSheetDocument): string {
  const sections = groupBlocks(doc.blocks)
    .map((group, i) => `
      <section>
        <h2><span class="no">${String(i + 1).padStart(2, '0')}</span>${escapeHtml(group.label)}
          <span class="count">${group.blocks.length}</span></h2>
        ${group.blocks.map(entryHtml).join('')}
      </section>`)
    .join('');
  const today = new Date().toLocaleDateString('zh-CN');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>角色卡·${escapeHtml(doc.name)}</title>
<style>
  @page { size: A4; margin: 14mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: #111110; background: #fff;
    font-family: "Helvetica Neue", Helvetica, Arial, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    font-size: 10.5pt; line-height: 1.55;
  }
  header { border-bottom: 4px solid #E42313; padding-bottom: 6mm; margin-bottom: 8mm; }
  .brand { display: flex; align-items: center; gap: 3mm; font-size: 8pt; letter-spacing: 0.3em; color: #666; }
  .brand::before { content: ""; width: 4mm; height: 4mm; background: #E42313; }
  h1 { margin: 4mm 0 0; font-size: 24pt; font-weight: 700; letter-spacing: 0.02em; }
  .facts { margin-top: 3mm; display: flex; gap: 8mm; font-size: 9pt; color: #444; }
  .facts b { color: #111; }
  .chip { display: inline-block; width: 3.5mm; height: 3.5mm; border: 1px solid #999; vertical-align: -0.5mm; }
  h2 {
    margin: 8mm 0 3mm; padding-top: 2mm; border-top: 2px solid #111;
    font-size: 11pt; letter-spacing: 0.25em; display: flex; align-items: baseline; gap: 2.5mm;
  }
  h2 .no { font-family: ui-monospace, monospace; font-size: 8pt; color: #E42313; letter-spacing: 0; }
  h2 .count { margin-left: auto; font-family: ui-monospace, monospace; font-size: 8pt; font-weight: 400; color: #999; }
  article.entry { break-inside: avoid; margin: 0 0 5mm; padding-left: 4mm; border-left: 1px solid #ddd; }
  article.entry h3 { margin: 0; font-size: 11.5pt; }
  article.entry .meta { margin: 0.5mm 0 1.5mm; font-size: 8.5pt; color: #777; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 1.5mm; }
  th, td { font-size: 9pt; text-align: left; vertical-align: top; padding: 0.6mm 0; }
  th { width: 18mm; font-weight: 400; color: #888; padding-right: 3mm; }
  .body p { margin: 0 0 1.5mm; }
  strong { font-weight: 600; }
  footer { margin-top: 10mm; padding-top: 2mm; border-top: 1px solid #ddd; font-size: 8pt; color: #999; }
</style>
</head>
<body>
  <header>
    <div class="brand">DND DM TOOL · 角色卡</div>
    <h1>${escapeHtml(doc.name)}</h1>
    <div class="facts">
      <span>颜色 <span class="chip" style="background:${escapeHtml(doc.color)}"></span></span>
      <span>最大生命值 <b>${doc.maxHp}</b></span>
      <span>条目 <b>${doc.blocks.length}</b></span>
      <span>导出 ${today}</span>
    </div>
  </header>
  ${sections || '<p style="color:#999">角色卡暂无条目。</p>'}
  <footer>由 DND DM TOOL 导出 · 打印时选择“另存为 PDF”即可生成文件</footer>
</body>
</html>`;
}

export function printSheet(doc: CharacterSheetDocument): void {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  const cleanup = () => { iframe.remove(); };
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) { cleanup(); return; }
    win.addEventListener('afterprint', cleanup);
    win.focus();
    win.print();
    // Fallback for browsers that never fire afterprint.
    setTimeout(cleanup, 120_000);
  };
  document.body.appendChild(iframe);
  iframe.srcdoc = buildSheetHtml(doc);
}
