import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { connection, useScene } from '../../ws';
import { preloadDecodedImage } from '../assets/imageCache';

export default function ScenePrepPanel() {
  const { scene, campaign, role, activeSceneId, viewingInactive } = useScene();
  const [noteCount, setNoteCount] = useState(0);
  const [warming, setWarming] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (!scene) return; api.sceneNotes(scene.id).then(notes => setNoteCount(notes.length)).catch(() => setNoteCount(0)); }, [scene?.id]);
  const checks = useMemo(() => scene ? [
    { label: '地图图像', ok: Boolean(scene.mapImage), detail: scene.mapImage ? `${scene.mapSize[0]} × ${scene.mapSize[1]}` : '尚未上传地图' },
    { label: '游戏区域', ok: scene.playArea.w > 0 && scene.playArea.h > 0, detail: `${scene.playArea.w} × ${scene.playArea.h}` },
    { label: '重置视图', ok: Boolean(scene.initialView), detail: scene.initialView ? `缩放 ${Math.round(scene.initialView.scale * 100)}%` : '未设置' },
    { label: 'Token 生命值', ok: scene.tokens.every(token => token.kind === 'npc' || token.hp), detail: `${scene.tokens.filter(token => token.hp).length}/${scene.tokens.length} 有 HP` },
    { label: '玩家可见性', ok: !scene.unlocked || scene.id === activeSceneId, detail: scene.unlocked ? '玩家可自行查看' : '仅激活时展示' },
    { label: '地图标记', ok: noteCount > 0, detail: `${noteCount} 个标记` },
  ] : [], [scene, activeSceneId, noteCount]);
  const ready = checks.filter(check => check.ok).length;
  const warmCampaign = async () => {
    if (!campaign) return;
    setWarming(true);
    try {
      const scenes = await api.scenes();
      const urls = scenes.filter(entry => campaign.sceneIds.includes(entry.id) && entry.mapImage).map(entry => entry.mapImage!);
      await Promise.allSettled(urls.map(url => preloadDecodedImage(url)));
      setNotice(`已预载 ${urls.length} 张场景地图`);
    } finally { setWarming(false); }
  };
  if (!scene) return <p className="p-3 text-xs text-zinc-500">正在读取场景…</p>;
  return <div className="h-full overflow-y-auto p-3"><div className="overflow-hidden rounded border border-zinc-800 bg-zinc-950/40">{scene.mapImage ? <img src={scene.mapImage} alt="" className="max-h-48 w-full object-contain" /> : <div className="grid h-32 place-items-center text-xs text-zinc-600">空白场景</div>}<div className="p-3"><div className="flex items-center gap-2"><h3 className="min-w-0 flex-1 truncate font-semibold">{scene.name}</h3><span className={`rounded px-2 py-0.5 text-xs ${ready === checks.length ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{ready}/{checks.length}</span></div><p className="mt-1 text-[10px] text-zinc-500">{scene.id === activeSceneId ? '当前激活场景' : viewingInactive ? '仅当前浏览器查看中' : '非活动场景'}</p></div></div><div className="mt-3 space-y-1">{checks.map(check => <div key={check.label} className="flex items-center gap-2 rounded bg-zinc-950/50 px-2 py-1.5 text-xs"><span className={`grid h-4 w-4 place-items-center rounded-full text-[9px] ${check.ok ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>{check.ok ? '✓' : '!'}</span><span className="text-zinc-300">{check.label}</span><span className="ml-auto text-zinc-600">{check.detail}</span></div>)}</div>{role === 'dm' && <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => void warmCampaign()} disabled={warming} className="rounded bg-sky-500/15 py-2 text-xs text-sky-300">{warming ? '预载中…' : '预载战役地图'}</button>{scene.id !== activeSceneId ? <button onClick={() => connection.activateScene(scene.id)} className="rounded bg-emerald-500/15 py-2 text-xs text-emerald-300">激活并同步全桌</button> : <button onClick={() => void api.updateScene(scene.id, { unlocked: !scene.unlocked }).then(() => setNotice(scene.unlocked ? '已锁定玩家自行查看' : '已允许玩家自行查看'))} className="rounded bg-zinc-800 py-2 text-xs text-zinc-300">{scene.unlocked ? '锁定玩家预览' : '开放玩家预览'}</button>}</div>}{notice && <p className="mt-2 text-xs text-emerald-400">{notice}</p>}<p className="mt-4 text-[10px] leading-5 text-zinc-600">场景配置中的地图比例、网格、游戏区域和重置视图仍是权威设置；此检查表只提示遗漏，不会自动改变地图。</p></div>;
}

