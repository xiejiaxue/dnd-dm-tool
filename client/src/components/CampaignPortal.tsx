import { useEffect, useState, type FormEvent } from 'react';
import { api, type CampaignCharacterSummary, type RoomBootstrap } from '../api';

interface Props {
  room: RoomBootstrap;
  onReady: () => Promise<void>;
  onLeave: () => void;
}

export default function CampaignPortal({ room, onReady, onLeave }: Props) {
  const canManage = Boolean(room.membership?.canManage);
  const role = room.membership?.roomRole ?? room.membership?.role ?? 'player';
  const needsCharacter = role === 'player' && Boolean(room.activeCampaign) && !room.selectedCharacter;
  const [characters, setCharacters] = useState<CampaignCharacterSummary[]>([]);
  const [campaignName, setCampaignName] = useState('');
  const [moduleId, setModuleId] = useState(room.modules[0]?.id ?? '');
  const [characterName, setCharacterName] = useState('');
  const [characterColor, setCharacterColor] = useState('#38a169');
  const [maxHp, setMaxHp] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!needsCharacter || !room.activeCampaign) return;
    void api.characters(room.activeCampaign.id).then(setCharacters).catch(cause => {
      setError(cause instanceof Error ? cause.message : '无法读取角色');
    });
  }, [needsCharacter, room.activeCampaign?.id]);

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await onReady();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  const createSave = (event: FormEvent) => {
    event.preventDefault();
    if (!campaignName.trim() || !moduleId) return;
    void run(async () => {
      const save = await api.createCampaign(campaignName.trim(), moduleId);
      await api.selectCampaign(save.id);
    });
  };

  const createCharacter = (event: FormEvent) => {
    event.preventDefault();
    if (!room.activeCampaign || !characterName.trim()) return;
    void run(async () => {
      const character = await api.createCharacter({
        campaignId: room.activeCampaign!.id,
        name: characterName.trim(),
        color: characterColor,
        maxHp,
      });
      await api.selectCharacter(room.activeCampaign!.id, character.id);
    });
  };

  return (
    <main className="h-full overflow-auto bg-zinc-950 text-zinc-100 p-5 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-amber-400">房间</p>
            <h1 className="mt-1 text-2xl font-semibold">{room.room.name}</h1>
          </div>
          <button onClick={onLeave} className="rounded border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800">返回大厅</button>
        </div>

        {canManage ? (
          <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
            <section>
              <h2 className="mb-3 text-lg font-medium">选择战役存档</h2>
              <div className="space-y-3">
                {room.campaigns.map(save => (
                  <button
                    key={save.id}
                    disabled={busy}
                    onClick={() => { void run(() => api.selectCampaign(save.id)); }}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900/70 p-4 text-left transition hover:-translate-y-0.5 hover:border-amber-500/60 hover:bg-zinc-900 disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{save.name}</span>
                      {save.active && <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-xs text-emerald-300">上次游玩</span>}
                    </div>
                    <div className="mt-2 text-sm text-zinc-500">模组：{save.moduleName} · {save.lastPlayedAt ? new Date(save.lastPlayedAt).toLocaleString() : '尚未开始'}</div>
                  </button>
                ))}
                {room.campaigns.length === 0 && <div className="rounded-xl border border-dashed border-zinc-700 p-6 text-sm text-zinc-500">尚无战役存档，请从右侧模组创建。</div>}
              </div>
            </section>

            <form onSubmit={createSave} className="h-fit rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
              <h2 className="text-lg font-medium">开始新战役</h2>
              <label className="mt-4 block text-sm text-zinc-400">战役存档名</label>
              <input value={campaignName} onChange={event => setCampaignName(event.target.value)} placeholder="例如：失落矿坑·周六团"
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-500" />
              <label className="mt-4 block text-sm text-zinc-400">模组模板</label>
              <select value={moduleId} onChange={event => setModuleId(event.target.value)}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-500">
                {room.modules.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}
              </select>
              <p className="mt-2 text-xs text-zinc-500">{room.modules.find(module => module.id === moduleId)?.description}</p>
              <button disabled={busy || !campaignName.trim() || !moduleId}
                className="mt-5 w-full rounded-lg bg-amber-500 px-4 py-2 font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-40">
                {busy ? '正在载入…' : '创建并进入'}
              </button>
            </form>
          </div>
        ) : !room.activeCampaign ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-8 text-center text-zinc-400">等待 DM 选择战役存档…</div>
        ) : needsCharacter ? (
          <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <section>
              <h2 className="mb-1 text-lg font-medium">选择角色</h2>
              <p className="mb-4 text-sm text-zinc-500">战役：{room.activeCampaign.name}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {characters.map(character => (
                  <button key={character.id} disabled={busy}
                    onClick={() => { void run(() => api.selectCharacter(room.activeCampaign!.id, character.id)); }}
                    className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 text-left hover:border-emerald-500/60 disabled:opacity-50">
                    <div className="flex items-center gap-3"><span className="h-4 w-4 rounded-full" style={{ backgroundColor: character.color }} /><span className="font-medium">{character.name}</span></div>
                    <p className="mt-2 text-sm text-zinc-500">最大生命值 {character.maxHp}</p>
                  </button>
                ))}
              </div>
            </section>
            <form onSubmit={createCharacter} className="h-fit rounded-xl border border-zinc-800 bg-zinc-900/70 p-5">
              <h2 className="text-lg font-medium">创建战役角色</h2>
              <input value={characterName} onChange={event => setCharacterName(event.target.value)} placeholder="角色名"
                className="mt-4 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-emerald-500" />
              <div className="mt-3 flex gap-3">
                <label className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-400">颜色<input type="color" value={characterColor} onChange={event => setCharacterColor(event.target.value)} className="ml-auto" /></label>
                <label className="flex flex-1 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-400">生命<input type="number" min="1" max="9999" value={maxHp} onChange={event => setMaxHp(Number(event.target.value))} className="min-w-0 flex-1 bg-transparent text-right text-zinc-100 outline-none" /></label>
              </div>
              <button disabled={busy || !characterName.trim()} className="mt-4 w-full rounded-lg bg-emerald-500 px-4 py-2 font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40">创建并进入</button>
            </form>
          </div>
        ) : (
          <button onClick={() => { void onReady(); }} className="rounded bg-emerald-500 px-4 py-2 text-zinc-950">进入战役</button>
        )}
        {error && <p className="mt-5 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
      </div>
    </main>
  );
}
