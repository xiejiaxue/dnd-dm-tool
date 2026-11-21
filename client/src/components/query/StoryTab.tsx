import { useEffect, useMemo, useRef, useState } from 'react';
import { isRoomArea, type PresetArea, type PresetScene, type StoryScene } from '../../../../shared/encounter-presets';
import { api } from '../../api';
import { requestBoardFocus } from '../../board-focus';
import { areaExplored, areaQuestId, areaTitle, nextStage, PRESET_ROUTES, SCENE_STAGE_LABELS, sceneQuestId, sceneStage, type SceneStage } from '../../story';
import { connection } from '../../ws';
import MiniMarkdown from './MiniMarkdown';
import type { PanelDetail, QuerySceneState } from './types';

const STAGE_MARK: Record<SceneStage, string> = { open: '', active: '●', done: '✓' };

function setStage(sceneId: string, stage: SceneStage) {
  connection.sendOps([{ op: 'setQuestStatus', questId: sceneQuestId(sceneId), status: stage }]);
}

function setExplored(sceneId: string, areaKey: string, explored: boolean) {
  connection.sendOps([{ op: 'setQuestStatus', questId: areaQuestId(sceneId, areaKey), status: explored ? 'done' : 'open' }]);
}

/** Switches the board to a scene; a waiting focus request flies there once its map is up. */
function goTo(sceneId: string, currentId: string | undefined, campaign: QuerySceneState['campaign']) {
  if (sceneStage(campaign, sceneId) === 'open') setStage(sceneId, 'active');
  if (sceneId !== currentId) connection.sendControl({ type: 'switchScene', sceneId });
}

interface DetailProps extends QuerySceneState {
  story: StoryScene;
  preset: PresetScene | null | undefined;
  onDetail: (detail: PanelDetail) => void;
}

/** One scene's steps: the overview, its story sections and rooms, each one click from the map. */
function SceneSteps({ story, preset, scene, campaign, onDetail }: DetailProps) {
  if (preset === undefined) return <p className="story-muted">正在加载场景资料…</p>;
  if (!preset) return <p className="story-muted">这个场景没有模组预设资料。可以用地图笔记记录要点。</p>;
  const areas = preset.areas ?? [];
  const sections = areas.filter(area => !isRoomArea(area)), rooms = areas.filter(isRoomArea);
  const isCurrent = story.sceneId === scene?.id;
  const locate = (area: PresetArea) => {
    const point = area.positions?.[0] as [number, number] | undefined;
    requestBoardFocus({ sceneId: story.sceneId, areaKey: area.key, ...(point ? { point } : {}) });
    if (!isCurrent) goTo(story.sceneId, scene?.id, campaign);
  };
  const open = (area: PresetArea) => onDetail({ type: 'note', id: `${story.sceneId}:${area.key}`, title: areaTitle(area), meta: story.name, text: area.text, sceneId: story.sceneId });
  const step = (area: PresetArea) => {
    const done = areaExplored(campaign, story.sceneId, area.key);
    return <li key={area.key} className={done ? 'is-done' : ''}>
      <input type="checkbox" checked={done} aria-label={`${areaTitle(area)} ${isRoomArea(area) ? '已探索' : '已完成'}`} onChange={event => setExplored(story.sceneId, area.key, event.target.checked)} />
      <button type="button" className="story-step-name" onClick={() => open(area)} title="在资料面板阅读全文">{areaTitle(area)}</button>
      {(area.positions?.length || isRoomArea(area)) ? <button type="button" className="story-locate" disabled={!area.positions?.length} title={area.positions?.length ? '切到这张地图并把镜头移到这里' : '地图上没有找到这个编号'} onClick={() => locate(area)}>定位</button> : null}
    </li>;
  };
  const doneCount = (list: PresetArea[]) => list.filter(area => areaExplored(campaign, story.sceneId, area.key)).length;
  return <div className="story-steps">
    {preset.notes && <details className="story-brief">
      <summary>本场要完成什么 · 开场准备</summary>
      <div className="story-brief-text"><MiniMarkdown text={preset.notes} /></div>
    </details>}
    {sections.length > 0 && <>
      <h4>剧情步骤 <span>{doneCount(sections)}/{sections.length}</span></h4>
      <ol>{sections.map(step)}</ol>
    </>}
    {rooms.length > 0 && <>
      <h4>地点 <span>已探索 {doneCount(rooms)}/{rooms.length}</span></h4>
      <ul>{rooms.map(step)}</ul>
    </>}
    {!areas.length && <p className="story-muted">这张地图没有房间或步骤条目。</p>}
  </div>;
}

/**
 * The DM's story route: every scene of the campaign in order, grouped by module chapter, with
 * where the table is, what is done and what comes next. Rooms and steps fly the board to their
 * spot, switching maps when needed, so the DM spends less time searching notes and maps.
 */
export default function StoryTab({ scene, role, campaign, templateId, onDetail }: QuerySceneState & { templateId?: string; onDetail: (detail: PanelDetail) => void }) {
  const [list, setList] = useState<StoryScene[] | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(scene ? [scene.id] : []));
  const [presets, setPresets] = useState<Record<string, PresetScene | null>>({});
  const route = templateId ? PRESET_ROUTES[templateId] : undefined;
  const sceneKey = (campaign?.sceneIds ?? []).join(',');

  useEffect(() => {
    if (role !== 'dm') return;
    let active = true;
    api.story().then(rows => { if (active) { setList(rows); setError(''); } }, failure => { if (active) setError(failure instanceof Error ? failure.message : '读取剧情路线失败'); });
    return () => { active = false; };
  }, [role, sceneKey, scene?.name]);

  // The scene on the board opens by itself, so the route always shows where the table is.
  // Moving on folds the previous scene away and brings the new one into view.
  const currentRow = useRef<HTMLLIElement>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const firstScene = useRef(true);
  useEffect(() => {
    if (!scene?.id) return;
    if (firstScene.current) firstScene.current = false;
    else setExpanded(new Set([scene.id]));
    setScrollTick(n => n + 1);
  }, [scene?.id]);
  useEffect(() => { currentRow.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); }, [scrollTick, list]);

  useEffect(() => {
    if (!route || role !== 'dm' || !list) return;
    const missing = [...expanded].filter(id => !(id in presets) && list.some(row => row.sceneId === id && row.preset));
    for (const id of missing) {
      api.presetScene(route, id).then(preset => setPresets(current => ({ ...current, [id]: preset })), () => setPresets(current => ({ ...current, [id]: null })));
    }
  }, [route, role, list, expanded, presets]);

  const chapters = useMemo(() => {
    const groups: { name: string; scenes: StoryScene[] }[] = [];
    for (const row of list ?? []) {
      const name = row.chapter ?? '其他场景';
      const last = groups[groups.length - 1];
      if (last?.name === name) last.scenes.push(row); else groups.push({ name, scenes: [row] });
    }
    return groups;
  }, [list]);

  if (role !== 'dm') return null;
  if (error) return <p role="alert" className="p-3 text-sm">{error}</p>;
  if (!list) return <p className="p-3 text-sm">正在读取剧情路线…</p>;

  const index = list.findIndex(row => row.sceneId === scene?.id);
  const current = index >= 0 ? list[index] : null;
  const next = list.slice(index + 1).find(row => sceneStage(campaign, row.sceneId) !== 'done') ?? null;
  const done = list.filter(row => sceneStage(campaign, row.sceneId) === 'done').length;
  const toggle = (id: string) => setExpanded(currentSet => { const copy = new Set(currentSet); if (copy.has(id)) copy.delete(id); else copy.add(id); return copy; });
  const finishAndAdvance = () => {
    if (current) setStage(current.sceneId, 'done');
    if (next) goTo(next.sceneId, scene?.id, campaign);
  };

  return <div className="story-route">
    <div className="story-now">
      <div className="story-progress" aria-label={`已完成 ${done}/${list.length} 个场景`}>
        <span style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} />
      </div>
      <p><span className="story-muted">已完成 {done}/{list.length} 场</span>{current?.chapter && <span className="story-muted"> · {current.chapter}</span>}</p>
      <p className="story-now-title">当前：<strong>{current?.name ?? '—'}</strong></p>
      {current?.preset?.brief && <p className="story-muted story-now-brief">{current.preset.brief}</p>}
      {next ? <div className="story-next">
        <span>下一场：<strong>{next.name}</strong></span>
        <button type="button" className="btn-xs" onClick={() => goTo(next.sceneId, scene?.id, campaign)}>前往</button>
        {current && <button type="button" className="btn-xs" title="把当前场景标为已完成，并切到下一场" onClick={finishAndAdvance}>完成本场 → 下一场</button>}
      </div> : <p className="story-muted">后面没有未完成的场景了。</p>}
    </div>
    <div className="story-chapters">
      {chapters.map(chapter => <section key={chapter.name} className="story-chapter">
        <h3>{chapter.name}<span>{chapter.scenes.filter(row => sceneStage(campaign, row.sceneId) === 'done').length}/{chapter.scenes.length}</span></h3>
        <ol>{chapter.scenes.map(row => {
          const stage = sceneStage(campaign, row.sceneId), isCurrent = row.sceneId === scene?.id, open = expanded.has(row.sceneId);
          const steps = row.preset ? row.preset.rooms + row.preset.sections : 0;
          return <li key={row.sceneId} ref={isCurrent ? currentRow : undefined} className={`story-scene is-${stage}${isCurrent ? ' is-current' : ''}`}>
            <div className="story-scene-row">
              <button type="button" className="story-stage" onClick={() => setStage(row.sceneId, nextStage(stage))}
                title={`${SCENE_STAGE_LABELS[stage]}（点击切换：未开始 → 进行中 → 已完成）`} aria-label={`${row.name}：${SCENE_STAGE_LABELS[stage]}，点击切换`}>{STAGE_MARK[stage]}</button>
              <button type="button" className="story-scene-name" aria-expanded={open} onClick={() => toggle(row.sceneId)}>
                <span>{row.name}</span>
                <small>{SCENE_STAGE_LABELS[stage]}{steps ? ` · ${steps} 个地点/步骤` : ''}{row.preset?.encounters ? ` · ${row.preset.encounters} 条遭遇` : ''}{row.unlocked ? ' · 玩家可见' : ''}</small>
              </button>
              {isCurrent ? <span className="story-here">当前</span> : <button type="button" className="btn-xs" onClick={() => goTo(row.sceneId, scene?.id, campaign)}>前往</button>}
            </div>
            {open && <SceneSteps story={row} preset={row.preset ? presets[row.sceneId] : null} scene={scene} role={role} campaign={campaign} onDetail={onDetail} />}
          </li>;
        })}</ol>
      </section>)}
    </div>
  </div>;
}
