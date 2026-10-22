import { useEffect, useState } from 'react';
import catalog from '../../../../shared/strahd/index.json';
import type { StrahdEncounter, StrahdScene } from '../../../../shared/strahd-types';
import { api } from '../../api';
import { connection } from '../../ws';
import { spawnEnemy } from './actions';
import type { DetailEntry, QuerySceneState } from './types';
const index = catalog.map(n => ({...n, type:'monster' as const}));
function Encounter({ encounter: e, sceneId, setDetail }: { encounter: StrahdEncounter; sceneId: string; setDetail: (entry:DetailEntry)=>void }) {
  const [count,setCount] = useState(String(e.count ?? 1));
  const [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const add = async () => {
    setBusy(true); setMessage('');
    try { const r = await api.addStrahdEncounter(sceneId,e.key,Number(count)); setMessage(`已加入 ${r.added} 个隐藏 Token`); }
    catch(error) { setMessage(error instanceof Error ? error.message : '加入失败'); }
    finally { setBusy(false); }
  };
  return <div className="p-3 border-b border-line space-y-2">
    <button className="flex items-center gap-3 text-left" onClick={()=>setDetail({type:'monster',id:e.entryId,nameZh:e.name})}>
      <img loading="lazy" className="w-10 h-10 rounded-full" src={`/api/token/${e.entryId}`} alt={`${e.name} Token`} />
      <span><strong className="block text-sm">{e.name}</strong><span className="text-xs text-muted">{e.region} · {e.section}</span></span>
    </button>
    <p className="text-xs">原文数量：{e.quantity} · {e.hp ? `HP ${e.hp}` : '非战斗人物／未给定 HP'} · {e.source}</p>
    <p className="text-xs text-muted">{e.condition}</p>
    <p className="text-xs text-muted">{e.automatic ? '新战役已预置此项；下方操作会额外增加。' : '按触发条件及存活数量加入。'}{!e.position && '加入地图中央后，可拖至实际位置。'}</p>
    <div className="flex items-center gap-2"><input aria-label={`${e.name}放置数量`} type="number" min="1" max="100" value={count} onChange={v=>setCount(v.target.value)} className="w-16 bg-well border border-line px-2 py-1 text-sm" /><button className="btn-xs" disabled={busy || !Number.isInteger(Number(count)) || Number(count)<1 || Number(count)>100} onClick={add}>{busy?'加入中…':'加入隐藏 Token'}</button></div>
    {message && <p role="status" className="text-xs">{message}</p>}
  </div>;
}
export default function StrahdTab({scene,role,campaign,setDetail}:QuerySceneState & {setDetail:(entry:DetailEntry)=>void}) {
  const [mode,setMode] = useState<'scene'|'library'>('scene');
  const [loaded,setLoaded] = useState<{id:string;data:StrahdScene|null}|null>(null);
  const [error,setError] = useState(''), [query,setQuery] = useState(''), [section,setSection] = useState(''), [chapter,setChapter] = useState('');
  const sceneId=scene?.id;
  useEffect(()=>{let active=true;setLoaded(null);setError('');setSection('');if(sceneId && role==='dm') api.strahdScene(sceneId).then(data=>{if(active)setLoaded({id:sceneId,data});}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[sceneId,role]);
  if(role!=='dm')return null;
  const preset=loaded && loaded.id===sceneId ? loaded.data : null;
  const q=query.trim().toLocaleLowerCase();
  const encounters=preset?.encounters.filter(e=>(!section||e.section===section)&&`${e.name} ${e.region} ${e.condition}`.toLocaleLowerCase().includes(q))??[];
  const rows=index.filter(n=>(!chapter||n.chapters.includes(chapter))&&n.nameZh.toLocaleLowerCase().includes(q));
  return <div className="flex-1 flex flex-col min-h-0">
    <div className="p-3 border-b border-line space-y-2">
      <strong className="text-sm">施特拉德的诅咒 · 2014 版</strong>
      <div className="flex gap-2"><button className="btn-xs" aria-pressed={mode==='scene'} onClick={()=>setMode('scene')}>本场景遭遇</button><button className="btn-xs" aria-pressed={mode==='library'} onClick={()=>setMode('library')}>NPC 与怪物库</button></div>
      <input aria-label="搜索施特拉德资料" placeholder="姓名、区域或触发条件" value={query} onChange={e=>setQuery(e.target.value)} className="w-full bg-well border border-line rounded px-2 py-1.5 text-sm" />
      {mode==='scene'?<select aria-label="遭遇类型" value={section} onChange={e=>setSection(e.target.value)} className="w-full bg-well border border-line px-2 py-1 text-sm"><option value="">全部遭遇类型</option>{[...new Set(preset?.encounters.map(e=>e.section))].map(s=><option key={s}>{s}</option>)}</select>:<select aria-label="施特拉德章节" value={chapter} onChange={e=>setChapter(e.target.value)} className="w-full bg-well border border-line px-2 py-1 text-sm"><option value="">全部章节</option>{[...new Set(index.flatMap(n=>n.chapters))].sort().map(s=><option key={s}>{s}</option>)}</select>}
    </div>
    <div className="flex-1 overflow-y-auto">
      {mode==='scene'?<>
        {error && <p role="alert" className="p-3 text-sm">{error}</p>}
        {!error&&!loaded&&<p className="p-3 text-sm">正在加载场景遭遇…</p>}
        {loaded&&!preset&&<p className="p-3 text-sm">当前地图不是施特拉德预设场景。可在「NPC 与怪物库」选取人物，或从首页选择本模组新建战役。</p>}
        {preset&&<div className="p-3 border-b border-line text-xs space-y-2"><strong>{preset.name}</strong><p>共 {encounters.length} 条。固定单位已按区域预置并对玩家隐藏。随机遭遇、增援与跨层人物按条件加入；跨图同名人物需沿用实际存活状态。</p>{preset.notes&&<details><summary className="cursor-pointer">机关、战术与避免重复计数</summary><p className="whitespace-pre-wrap mt-2">{preset.notes}</p></details>}</div>}
        {encounters.map(e=><Encounter key={`${sceneId}-${e.key}`} encounter={e} sceneId={sceneId!} setDetail={setDetail}/>)}
        {preset&&!encounters.length&&<p className="p-3 text-sm">没有符合筛选条件的遭遇。</p>}
      </>:<><p className="p-3 text-xs text-muted">{rows.length} 份数据卡，保留场景调整产生的不同版本。</p>{rows.map(n=><div key={n.id} className="p-3 border-b border-line">
        <button onClick={()=>setDetail(n)} className="w-full flex gap-3 text-left items-center"><img loading="lazy" src={`/api/token/${n.id}`} alt={`${n.nameZh} Token`} className="w-12 h-12 rounded-full"/><span><strong className="block text-sm">{n.nameZh}</strong><span className="block text-xs text-muted">CR {n.cr||'—'} · HP {n.hp??'—'}</span><span className="block text-xs text-muted">{n.chapters.join('、')}</span></span></button>
        <div className="mt-2 flex gap-3 justify-end text-xs"><button className="text-accent" onClick={()=>spawnEnemy(scene,n.id,n.nameZh)}>＋ 放置 Token</button><button className="text-accent disabled:text-muted" disabled={campaign?.enemies.some(e=>e.entryId===n.id)} onClick={()=>connection.sendOps([{op:'addEnemy',entryId:n.id,nameZh:n.nameZh}])}>{campaign?.enemies.some(e=>e.entryId===n.id)?'已在战役库':'加入战役库'}</button></div>
      </div>)}{!rows.length&&<p className="p-3 text-sm">没有符合条件的 NPC 或怪物。</p>}</>}
    </div>
  </div>;
}
