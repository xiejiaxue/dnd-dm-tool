import { Fragment, type ReactNode } from 'react';

// Renders the small Markdown subset used by the DM notes: ###/#### headings,
// paragraphs, **bold**, > quotes, - and 1. lists, and pipe tables. Text stays
// React text nodes, so nothing is injected as HTML.

export function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => part.startsWith('**') && part.endsWith('**') && part.length > 4
    ? <strong key={index} className="font-semibold text-ink">{part.slice(2, -2)}</strong>
    : <Fragment key={index}>{part}</Fragment>);
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
const isDivider = (line: string) => /^\s*\|[\s:|-]+\|\s*$/.test(line);

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

export function parseBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = /^#{3,6}\s+(.+)$/.exec(trimmed);
    if (heading) { blocks.push({ kind: 'heading', text: heading[1] }); continue; }
    if (trimmed.startsWith('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const rows: string[][] = [];
      let next = i + 2;
      while (next < lines.length && lines[next].trim().startsWith('|')) rows.push(cells(lines[next++]));
      blocks.push({ kind: 'table', header: cells(line), rows: rows.filter(row => row.some(Boolean)) });
      i = next - 1;
      continue;
    }
    const collect = (match: (value: string) => boolean, strip: (value: string) => string) => {
      const items: string[] = [];
      while (i < lines.length && match(lines[i].trim())) items.push(strip(lines[i++].trim()));
      i -= 1;
      return items;
    };
    if (trimmed.startsWith('>')) { blocks.push({ kind: 'quote', lines: collect(value => value.startsWith('>'), value => value.replace(/^>\s?/, '')) }); continue; }
    if (/^[-*]\s+/.test(trimmed)) { blocks.push({ kind: 'list', ordered: false, items: collect(value => /^[-*]\s+/.test(value), value => value.replace(/^[-*]\s+/, '')) }); continue; }
    if (/^\d+\.\s+/.test(trimmed)) { blocks.push({ kind: 'list', ordered: true, items: collect(value => /^\d+\.\s+/.test(value), value => value.replace(/^\d+\.\s+/, '')) }); continue; }
    const paragraph = collect(value => Boolean(value) && !/^(#{3,6}\s|>|[-*]\s|\d+\.\s|\|)/.test(value), value => value);
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph });
    else blocks.push({ kind: 'paragraph', lines: [trimmed] });
  }
  return blocks;
}

export default function MiniMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-xs leading-relaxed text-ink">
      {parseBlocks(text).map((block, index) => {
        switch (block.kind) {
          case 'heading': return <h4 key={index} className="pt-1 text-xs font-bold">{inline(block.text)}</h4>;
          case 'quote': return <blockquote key={index} className="border-l-2 border-accent bg-well px-2 py-1 text-muted">{block.lines.map((line, at) => <p key={at}>{inline(line)}</p>)}</blockquote>;
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return <List key={index} className={`space-y-1 pl-4 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>{block.items.map((item, at) => <li key={at}>{inline(item)}</li>)}</List>;
          }
          case 'table': return (
            <div key={index} className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead><tr>{block.header.map((cell, at) => <th key={at} className="border border-line bg-well px-1.5 py-1 text-left font-semibold">{inline(cell)}</th>)}</tr></thead>
                <tbody>{block.rows.map((row, at) => <tr key={at}>{block.header.map((_, column) => <td key={column} className="border border-line px-1.5 py-1 align-top">{inline(row[column] ?? '')}</td>)}</tr>)}</tbody>
              </table>
            </div>
          );
          default: return <p key={index}>{block.lines.map((line, at) => <Fragment key={at}>{at > 0 && <br />}{inline(line)}</Fragment>)}</p>;
        }
      })}
    </div>
  );
}
