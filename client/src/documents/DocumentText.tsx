import type { ReactNode } from 'react';
import { openActorSheet } from '../features/actors/navigation';
import { useActionLog } from '../features/action-log/ActionLogContext';
import { openToolDocument } from '../features/tools/navigation';
import { openJournal } from './navigation';

const INLINE = /(\[\[(?:Actor|Item|Journal):[^\]]+\]\]|\[\[\/roll\s+[^\]]+\]\]|\*\*[^*]+\*\*)/gu;

export default function DocumentText({ text }: { text: string }) {
  const { roll } = useActionLog();
  const lines = text.split(/\r?\n/u);
  return <div className="space-y-2 text-sm leading-6 text-zinc-200">{lines.map((line, index) => {
    if (!line.trim()) return <div key={index} className="h-2" />;
    const heading = /^(#{1,3})\s+(.+)$/u.exec(line);
    if (heading) { const content = inline(heading[2], roll); return heading[1].length === 1 ? <h2 key={index} className="text-xl font-semibold">{content}</h2> : heading[1].length === 2 ? <h3 key={index} className="text-lg font-semibold">{content}</h3> : <h4 key={index} className="font-semibold">{content}</h4>; }
    const list = /^[-*]\s+(.+)$/u.exec(line);
    if (list) return <div key={index} className="flex gap-2"><span className="text-amber-400">•</span><span>{inline(list[1], roll)}</span></div>;
    return <p key={index}>{inline(line, roll)}</p>;
  })}</div>;
}

function inline(text: string, roll: ReturnType<typeof useActionLog>['roll']): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, index) => {
    const bold = /^\*\*(.+)\*\*$/u.exec(part);
    if (bold) return <strong key={index}>{bold[1]}</strong>;
    const dice = /^\[\[\/roll\s+([^|\]]+)(?:\|([^\]]+))?\]\]$/u.exec(part);
    if (dice) return <button key={index} type="button" onClick={() => void roll({ label: dice[2] ?? dice[1], formula: dice[1] })} className="mx-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-xs text-amber-300" title={`掷骰 ${dice[1]}`}>{dice[2] ?? dice[1]}</button>;
    const reference = /^\[\[(Actor|Item|Journal):([^|\]]+)(?:\|([^\]]+))?\]\]$/u.exec(part);
    if (reference) {
      const [, type, target, label] = reference;
      return <button key={index} type="button" onClick={() => openReference(type, target)} className="mx-0.5 rounded bg-sky-500/15 px-1.5 py-0.5 text-xs text-sky-300 hover:bg-sky-500/25">{label ?? target}</button>;
    }
    return part;
  });
}

function openReference(type: string, target: string): void {
  if (type === 'Actor') { openActorSheet(target); return; }
  if (type === 'Item') { openToolDocument({ type: 'item', id: target }); return; }
  const [journalId, pageId] = target.split('/', 2);
  openJournal({ journalId, pageId: pageId || null });
}

