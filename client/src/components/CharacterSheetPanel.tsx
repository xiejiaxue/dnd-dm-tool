import { useEffect, useState } from 'react';
import { api, type CharacterSheet } from '../api';
import type { EntryType } from '../types';
import DetailDrawer from './DetailDrawer';

export default function CharacterSheetPanel({ onClose }: { onClose: () => void }) {
  const [sheet, setSheet] = useState<CharacterSheet | null>(null);
  const [detail, setDetail] = useState<{ type: EntryType; id: string; nameZh: string } | null>(null);
  useEffect(() => { void api.characterSheet().then(setSheet); }, []);

  return (
    <div className="absolute right-3 top-12 z-40 flex h-[70vh] w-[min(92vw,520px)] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="flex items-center border-b border-zinc-800 px-4 py-3">
        <div><p className="text-xs text-zinc-500">D&D 5e 角色卡</p><h2 className="font-semibold">{sheet?.character.name ?? '加载中…'}</h2></div>
        {sheet && <div className="ml-4 text-xs text-zinc-400"><span style={{ color: sheet.character.color }}>●</span> 最大生命 {sheet.character.maxHp}</div>}
        <button onClick={onClose} className="ml-auto text-zinc-400 hover:text-white">✕</button>
      </div>
      <div className="relative flex-1 overflow-y-auto">
        {sheet?.entries.map(entry => (
          <div key={entry.id} className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
            <button onClick={() => setDetail({ type: entry.type, id: entry.entryId, nameZh: entry.name })} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-zinc-200">{entry.name}</span><span className="text-xs text-zinc-500">{entry.type} · {entry.source}</span>
            </button>
            <button onClick={() => { void api.removeCharacterEntry(entry.id).then(() => api.characterSheet()).then(setSheet); }} className="text-zinc-600 hover:text-red-400">✕</button>
          </div>
        ))}
        {sheet && sheet.entries.length === 0 && <p className="p-6 text-center text-sm text-zinc-500">在资料详情中点击“加入角色卡”，即可添加法术、装备、专长、职业能力等。</p>}
        {detail && <DetailDrawer entry={detail} onBack={() => setDetail(null)} />}
      </div>
    </div>
  );
}
