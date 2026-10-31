import { connection, useScene } from '../../ws';
import type { NoteDetail } from './types';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/** `text` with every occurrence of the search words marked. */
function Highlighted({ text, words }: { text: string; words?: string[] }) {
  if (!words?.length) return <>{text}</>;
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'giu');
  return <>{text.split(pattern).map((part, index) => index % 2 ? <mark key={index} className="bg-[#eec0b4] text-ink">{part}</mark> : part)}</>;
}

/** A module area note or scene overview, opened in the resource panel's detail slot. */
export default function NoteView({ note, onBack }: { note: NoteDetail; onBack: () => void }) {
  const { scene, role } = useScene();
  const canSwitch = role === 'dm' && note.sceneId && note.sceneId !== scene?.id;
  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-panel p-3 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <button onClick={onBack} aria-label="返回" className="text-muted hover:text-accent">←</button>
        <h2 className="min-w-0 flex-1 text-base font-bold">{note.title}</h2>
      </div>
      <p className="mb-3 text-xs text-muted">{note.meta} · 仅主持人可见，含剧透</p>
      {canSwitch && <button className="btn-xs mb-3" onClick={() => connection.sendControl({ type: 'switchScene', sceneId: note.sceneId })}>切换到此场景</button>}
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink"><Highlighted text={note.text} words={note.highlight} /></p>
    </div>
  );
}
