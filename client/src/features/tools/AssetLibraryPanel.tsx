import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import type { AssetSummary } from '../../types';
import { useScene } from '../../ws';

export default function AssetLibraryPanel() {
  const { role } = useScene();
  const canManage = role === 'dm';
  const [assets, setAssets] = useState<AssetSummary[]>([]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => { try { setAssets(await api.assetLibrary(includeArchived)); setError(''); } catch (cause) { setError(message(cause)); } }, [includeArchived]);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => assets.filter(asset => (kind === 'all' || kind === mediaKind(asset)) && asset.name.toLowerCase().includes(query.trim().toLowerCase())), [assets, kind, query]);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) await api.uploadAsset(file, uploadKind(file));
      await load();
    } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  const patch = async (asset: AssetSummary, input: { name?: string; archived?: boolean }) => { try { await api.updateAssetLibraryEntry(asset.id, input); await load(); } catch (cause) { setError(message(cause)); } };
  return <div className="flex h-full flex-col overflow-hidden"><header className="space-y-2 border-b border-zinc-800 p-2"><div className="flex gap-1"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索素材" className="min-w-0 flex-1 rounded bg-zinc-800 px-2 py-1 text-xs" /><select value={kind} onChange={event => setKind(event.target.value)} className="rounded bg-zinc-800 px-1 text-xs"><option value="all">全部</option><option value="image">图片</option><option value="audio">音频</option><option value="pdf">PDF</option></select></div><div className="flex items-center gap-2 text-[10px] text-zinc-500"><span>{visible.length} / {assets.length} 个素材</span>{canManage && <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={includeArchived} onChange={event => setIncludeArchived(event.target.checked)} />显示已归档</label>}</div>{canManage && <label className={`block cursor-pointer rounded border border-dashed border-zinc-700 py-2 text-center text-xs ${busy ? 'text-zinc-600' : 'text-zinc-400 hover:border-amber-600'}`}>{busy ? '上传中…' : '上传图片、PDF 或音频（自动去重）'}<input type="file" multiple accept="image/*,application/pdf,audio/*" disabled={busy} className="hidden" onChange={event => { void upload(event.target.files); event.currentTarget.value = ''; }} /></label>}{error && <p className="text-xs text-red-400">{error}</p>}</header><div className="grid flex-1 auto-rows-max grid-cols-2 gap-2 overflow-y-auto p-2">
    {visible.map(asset => <AssetCard key={asset.id} asset={asset} canManage={canManage} onPatch={input => void patch(asset, input)} />)}{visible.length === 0 && <p className="col-span-2 p-3 text-xs text-zinc-500">没有符合条件的素材。</p>}
  </div></div>;
}

function AssetCard({ asset, canManage, onPatch }: { asset: AssetSummary; canManage: boolean; onPatch(input: { name?: string; archived?: boolean }): void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(asset.name);
  const kind = mediaKind(asset);
  return (
    <article className={`overflow-hidden rounded border bg-zinc-950/50 ${asset.archived ? 'border-amber-900/60 opacity-70' : 'border-zinc-800'}`}>
      <div className="grid h-24 place-items-center overflow-hidden bg-zinc-950">
        {kind === 'image' ? <img src={asset.url} alt="" loading="lazy" className="h-full w-full object-contain" />
          : kind === 'audio' ? <audio src={asset.url} controls className="w-[95%]" />
            : <span className="text-xs text-zinc-500">PDF</span>}
      </div>
      <div className="p-2">
        {editing ? <input autoFocus value={name} onChange={event => setName(event.target.value)}
          onBlur={() => { if (name.trim() && name.trim() !== asset.name) onPatch({ name: name.trim() }); setEditing(false); }}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="w-full rounded bg-zinc-800 px-1 text-xs" />
          : <button onClick={() => canManage && setEditing(true)} className="block w-full truncate text-left text-xs" title={asset.name}>{asset.name}</button>}
        <div className="mt-1 flex items-center gap-1 text-[9px] text-zinc-600">
          <span>{formatBytes(asset.byteSize)}</span>
          <button onClick={() => void navigator.clipboard.writeText(new URL(asset.url, window.location.origin).href)} title="复制素材地址" className="ml-auto hover:text-zinc-300">复制链接</button>
          {canManage && <button onClick={() => onPatch({ archived: !asset.archived })}
            title={asset.archived ? '恢复到素材库' : '从素材库归档；已有引用继续可用'}
            className="hover:text-amber-300">{asset.archived ? '恢复' : '归档'}</button>}
        </div>
      </div>
    </article>
  );
}

function uploadKind(file: File): 'map' | 'attachment' { return file.type.startsWith('image/') ? 'map' : 'attachment'; }
function mediaKind(asset: AssetSummary): 'image' | 'audio' | 'pdf' { return asset.contentType.startsWith('audio/') ? 'audio' : asset.contentType === 'application/pdf' ? 'pdf' : 'image'; }
function formatBytes(value: number): string { return value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} KiB` : `${(value / 1024 / 1024).toFixed(1)} MiB`; }
function message(cause: unknown): string { return cause instanceof Error ? cause.message : '素材操作失败'; }
