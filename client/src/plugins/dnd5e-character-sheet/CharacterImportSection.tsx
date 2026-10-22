import { useEffect, useState } from 'react';
import type { ActorDirectorySectionProps } from '../../extensions/registry';
import type { PersonalCharacter } from '../../types';
import { characterSheetApi } from './api';

export default function CharacterImportSection({ roomRole, busy, onBusy, onError, onImported }: ActorDirectorySectionProps) {
  const [characters, setCharacters] = useState<PersonalCharacter[]>([]);
  const [selectedId, setSelectedId] = useState('');

  useEffect(() => {
    if (roomRole !== 'player') return;
    let cancelled = false;
    void characterSheetApi.roomCharacters()
      .then(result => {
        if (cancelled) return;
        setCharacters(result);
        setSelectedId(current => result.some(character => character.id === current) ? current : result[0]?.id ?? '');
      })
      .catch(cause => { if (!cancelled) onError(cause instanceof Error ? cause.message : '无法读取个人角色卡'); });
    return () => { cancelled = true; };
  }, [roomRole, onError]);

  if (roomRole !== 'player') return null;
  const importCharacter = async () => {
    if (!selectedId) return;
    onBusy(true);
    try {
      const result = await characterSheetApi.importIntoRoom(selectedId);
      await onImported(result.actorId);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '无法导入个人角色卡');
    } finally { onBusy(false); }
  };

  return (
    <section className="mt-3 rounded-lg border border-violet-500/20 bg-violet-950/10 p-2">
      <p className="text-xs font-medium text-violet-300">导入个人角色卡</p>
      <p className="mt-0.5 text-[10px] leading-4 text-zinc-500">导入会在当前房间创建一份独立 Actor 快照并自动认领；之后两边互不覆盖。</p>
      {characters.length > 0 ? (
        <div className="mt-2 flex gap-2">
          <select value={selectedId} onChange={event => setSelectedId(event.target.value)} className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-200">
            {characters.map(character => <option key={character.id} value={character.id}>{character.name} · {character.sheet.advancement.level}级</option>)}
          </select>
          <button type="button" onClick={() => void importCharacter()} disabled={busy || !selectedId} className="rounded bg-violet-500/15 px-3 text-xs text-violet-300 hover:bg-violet-500/25 disabled:opacity-40">导入并认领</button>
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-zinc-500">尚未保存个人角色卡。可返回首页，通过“创建 / 管理角色卡”建立。</p>
      )}
    </section>
  );
}
