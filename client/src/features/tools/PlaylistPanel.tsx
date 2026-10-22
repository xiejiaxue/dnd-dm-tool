import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { AssetSummary, JsonValue, PlaylistDocument, PlaylistTrack } from '../../types';
import { useScene } from '../../ws';
import { useTabletopSettings } from '../settings/TabletopSettingsContext';

export default function PlaylistPanel() {
  const { role } = useScene();
  const canManage = role === 'dm';
  const [playlists, setPlaylists] = useState<PlaylistDocument[]>([]);
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { const [next, library] = await Promise.all([api.playlists(), api.assetLibrary()]); setPlaylists(next); setAssets(library.filter(asset => asset.contentType.startsWith('audio/'))); } catch (cause) { setError(message(cause)); } }, []);
  useEffect(() => { void load(); }, [load]);
  const selected = playlists.find(playlist => playlist.id === selectedId) ?? null;
  const create = async () => { if (!name.trim()) return; try { const created = await api.createToolDocument<PlaylistDocument>('playlist', { name: name.trim(), ownership: { default: 'observer', users: {} }, data: { tracks: [] } }); setPlaylists(current => [...current, created]); setSelectedId(created.id); setName(''); } catch (cause) { setError(message(cause)); } };
  if (selected) return <PlaylistEditor playlist={selected} assets={assets} canManage={canManage} onBack={() => setSelectedId(null)} onSaved={updated => setPlaylists(current => current.map(value => value.id === updated.id ? updated : value))} onAssetUploaded={asset => setAssets(current => [asset, ...current])} />;
  return <div className="flex h-full flex-col"><div className="border-b border-zinc-800 p-2">{canManage && <div className="flex gap-1"><input value={name} onChange={event => setName(event.target.value)} placeholder="新播放列表" className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs" /><button onClick={() => void create()} className="rounded bg-amber-500/15 px-2 text-xs text-amber-300">新建</button></div>}{error && <p className="mt-1 text-xs text-red-400">{error}</p>}</div><div className="flex-1 overflow-y-auto">{playlists.map(playlist => <button key={playlist.id} onClick={() => setSelectedId(playlist.id)} className="flex w-full border-b border-zinc-800/70 px-3 py-2 text-left hover:bg-zinc-800"><span className="min-w-0 flex-1 truncate">{playlist.name}</span><span className="text-[10px] text-zinc-500">{playlist.tracks.length} 首</span></button>)}{playlists.length === 0 && <p className="p-3 text-xs text-zinc-500">创建环境音乐或音效板。播放只发生在当前面团主控设备。</p>}</div></div>;
}

function PlaylistEditor({ playlist, assets, canManage, onBack, onSaved, onAssetUploaded }: { playlist: PlaylistDocument; assets: AssetSummary[]; canManage: boolean; onBack(): void; onSaved(value: PlaylistDocument): void; onAssetUploaded(value: AssetSummary): void }) {
  const { confirmAction } = useTabletopSettings();
  const [draft, setDraft] = useState(playlist);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => { audioRef.current?.pause(); }, []);
  const save = async (next = draft) => { try { const updated = await api.updateToolDocument<PlaylistDocument>('playlist', playlist.id, { name: next.name, folder: next.folder, locked: next.locked, data: { tracks: next.tracks as unknown as JsonValue } }); setDraft(updated); onSaved(updated); return updated; } catch (cause) { setError(message(cause)); return null; } };
  const play = (track: PlaylistTrack) => {
    audioRef.current?.pause();
    if (playingId === track.id) { setPlayingId(null); return; }
    const audio = new Audio(track.assetUrl); audio.volume = track.volume; audio.loop = track.loop; audio.onended = () => setPlayingId(null); audio.play().catch(cause => setError(message(cause))); audioRef.current = audio; setPlayingId(track.id);
  };
  const addAsset = (asset: AssetSummary) => setDraft(current => ({ ...current, tracks: [...current.tracks, { id: crypto.randomUUID(), name: asset.name, assetUrl: asset.url, volume: .7, loop: false }] }));
  const upload = async (file: File | undefined) => {
    if (!file) return;
    try {
      const uploaded = await api.uploadAsset(file, 'attachment');
      const library = await api.assetLibrary();
      const asset = library.find(entry => entry.url === uploaded.url);
      if (asset) { onAssetUploaded(asset); addAsset(asset); }
    } catch (cause) { setError(message(cause)); }
  };
  const remove = async () => { if (!confirmAction(`删除播放列表“${playlist.name}”？音频素材仍保留在素材库。`)) return; try { await api.deleteToolDocument('playlist', playlist.id); onBack(); } catch (cause) { setError(message(cause)); } };
  return <div className="flex h-full flex-col overflow-hidden"><header className="flex items-center gap-2 border-b border-zinc-800 p-2"><button onClick={onBack}>←</button><input value={draft.name} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1" />{canManage && <button onClick={() => void save()} className="rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-300">保存</button>}</header><div className="flex-1 space-y-2 overflow-y-auto p-3">
    {draft.tracks.map(track => <article key={track.id} className={`rounded border p-2 ${playingId === track.id ? 'border-emerald-500/60 bg-emerald-950/20' : 'border-zinc-800'}`}><div className="flex items-center gap-2"><button onClick={() => play(track)} className="grid h-8 w-8 place-items-center rounded bg-zinc-800" title={playingId === track.id ? '停止' : '播放'} aria-label={`${playingId === track.id ? '停止' : '播放'} ${track.name}`}>{playingId === track.id ? '■' : '▶'}</button><span className="min-w-0 flex-1 truncate">{track.name}</span>{canManage && <button onClick={() => setDraft(current => ({ ...current, tracks: current.tracks.filter(value => value.id !== track.id) }))} title={`从播放列表移除 ${track.name}`} aria-label={`移除音轨 ${track.name}`} className="text-zinc-600 hover:text-red-300">×</button>}</div><div className="mt-2 flex items-center gap-2 text-[10px] text-zinc-500"><span>音量</span><input type="range" min={0} max={1} step={.05} value={track.volume} disabled={!canManage} onChange={event => setDraft(current => ({ ...current, tracks: current.tracks.map(value => value.id === track.id ? { ...value, volume: Number(event.target.value) } : value) }))} className="min-w-0 flex-1" />{canManage && <label className="flex items-center gap-1"><input type="checkbox" checked={track.loop} onChange={event => setDraft(current => ({ ...current, tracks: current.tracks.map(value => value.id === track.id ? { ...value, loop: event.target.checked } : value) }))} />循环</label>}</div></article>)}
    {canManage && <section className="rounded border border-zinc-800 p-2"><h4 className="mb-2 text-xs text-zinc-400">添加音频</h4><div className="max-h-36 overflow-y-auto">{assets.map(asset => <button key={asset.id} onClick={() => addAsset(asset)} className="flex w-full border-b border-zinc-800/50 px-2 py-1.5 text-left text-xs hover:bg-zinc-800"><span className="min-w-0 flex-1 truncate">{asset.name}</span><span>＋</span></button>)}</div><label className="mt-2 block cursor-pointer rounded border border-dashed border-zinc-700 py-2 text-center text-xs text-zinc-400">上传 MP3 / Ogg / WAV / M4A<input type="file" accept="audio/mpeg,audio/ogg,audio/wav,audio/mp4" className="hidden" onChange={event => { void upload(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label></section>}
    {canManage && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={draft.locked} onChange={event => setDraft(current => ({ ...current, locked: event.target.checked }))} />锁定播放列表</label>}{canManage && !draft.locked && <button onClick={() => void remove()} className="w-full rounded border border-red-900/50 py-1.5 text-xs text-red-300">删除播放列表</button>}{error && <p className="text-xs text-red-400">{error}</p>}
  </div></div>;
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : '播放列表操作失败'; }
