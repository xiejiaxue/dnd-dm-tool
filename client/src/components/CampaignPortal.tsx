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
    <main className="h-full overflow-auto bg-paper text-ink p-5 sm:p-10">
      <div className="mx-auto max-w-4xl">
        <header className="flex items-end justify-between gap-4">
          <div>
            <p className="panel-label">房间</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{room.room.name}</h1>
          </div>
          <button onClick={onLeave} className="btn-quiet">返回大厅</button>
        </header>
        <div aria-hidden className="mt-4 h-[3px] bg-ink" />

        {canManage ? (
          <div className="grid gap-10 lg:grid-cols-[1.35fr_1fr] lg:gap-0 pt-8">
            <section className="lg:pr-10">
              <h2 className="panel-label mb-2">选择战役存档</h2>
              <div>
                {room.campaigns.map(save => (
                  <button
                    key={save.id}
                    disabled={busy}
                    onClick={() => { void run(() => api.selectCampaign(save.id)); }}
                    className="group w-full border-b border-line p-3 -mx-1 px-1 text-left transition-colors duration-150 hover:bg-panel disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{save.name}</span>
                      {save.active && <span className="shrink-0 bg-ink px-1.5 py-0.5 text-[10px] font-bold tracking-label text-white">上次游玩</span>}
                    </div>
                    <div className="mt-1.5 text-sm text-muted">模组：{save.moduleName} · {save.lastPlayedAt ? new Date(save.lastPlayedAt).toLocaleString() : '尚未开始'}</div>
                  </button>
                ))}
                {room.campaigns.length === 0 && <div className="border border-line bg-panel p-6 text-sm text-muted">尚无战役存档，请从右侧模组创建。</div>}
              </div>
            </section>

            <form onSubmit={createSave} className="h-fit lg:border-l lg:border-line lg:pl-10">
              <h2 className="panel-label">开始新战役</h2>
              <label className="mt-5 block text-xs text-muted">战役存档名</label>
              <input value={campaignName} onChange={event => setCampaignName(event.target.value)} placeholder="例如：失落矿坑·周六团"
                className="field mt-1.5" />
              <label className="mt-4 block text-xs text-muted">模组模板</label>
              <select value={moduleId} onChange={event => setModuleId(event.target.value)}
                className="field mt-1.5">
                {room.modules.map(module => <option key={module.id} value={module.id}>{module.name}</option>)}
              </select>
              <p className="mt-2 text-xs text-muted">{room.modules.find(module => module.id === moduleId)?.description}</p>
              <button disabled={busy || !campaignName.trim() || !moduleId}
                className="btn-accent mt-5 w-full">
                {busy ? '正在载入…' : '创建并进入'}
              </button>
            </form>
          </div>
        ) : !room.activeCampaign ? (
          <div className="mt-8 border border-line bg-panel p-8 text-center text-muted">等待 DM 选择战役存档…</div>
        ) : needsCharacter ? (
          <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:gap-0 pt-8">
            <section className="lg:pr-10">
              <h2 className="panel-label">选择角色</h2>
              <p className="mt-1.5 text-sm text-muted">战役：{room.activeCampaign.name}</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {characters.map(character => (
                  <button key={character.id} disabled={busy}
                    onClick={() => { void run(() => api.selectCharacter(room.activeCampaign!.id, character.id)); }}
                    className="border border-line bg-panel p-3 text-left transition-colors duration-150 hover:border-ink disabled:opacity-50">
                    <div className="flex items-center gap-2"><span className="h-3.5 w-3.5 shrink-0" style={{ backgroundColor: character.color }} /><span className="font-medium">{character.name}</span></div>
                    <p className="mt-1.5 text-sm text-muted tabular-nums">最大生命值 {character.maxHp}</p>
                  </button>
                ))}
              </div>
            </section>
            <form onSubmit={createCharacter} className="h-fit lg:border-l lg:border-line lg:pl-10">
              <h2 className="panel-label">创建战役角色</h2>
              <input value={characterName} onChange={event => setCharacterName(event.target.value)} placeholder="角色名"
                className="field mt-4" />
              <div className="mt-3 flex gap-3">
                <label className="flex flex-1 items-center gap-2 field text-xs text-muted">颜色<input type="color" value={characterColor} onChange={event => setCharacterColor(event.target.value)} className="ml-auto" /></label>
                <label className="flex flex-1 items-center gap-2 field text-xs text-muted">生命<input type="number" min="1" max="9999" value={maxHp} onChange={event => setMaxHp(Number(event.target.value))} className="min-w-0 flex-1 bg-transparent text-right tabular-nums text-ink outline-none" /></label>
              </div>
              <button disabled={busy || !characterName.trim()} className="btn-accent mt-4 w-full">创建并进入</button>
            </form>
          </div>
        ) : (
          <button onClick={() => { void onReady(); }} className="btn-accent mt-8">进入战役</button>
        )}
        {error && <p className="mt-6 border border-line border-l-4 border-l-accent bg-panel px-3 py-2 text-sm text-accent">{error}</p>}
      </div>
    </main>
  );
}
