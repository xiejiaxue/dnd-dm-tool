import { memo, useEffect, useState } from 'react';
import { Circle, Group, Label, Tag, Text } from 'react-konva';
import { isRoomArea, type PresetArea } from '../../../shared/encounter-presets';
import { api } from '../api';

import { areaTitle, PRESET_ROUTES } from '../story';

export { areaTitle, PRESET_ROUTES };

/** Rooms are keyed by their map label (K7, N2a, 12); `a01`… are the scene's own v2 sections. */
export const isRoom = isRoomArea;

/** The current scene's keyed notes, loaded for the DM whenever a module map opens. */
export function useRoomNotes(sceneId: string | undefined, mapImage: string | null | undefined, templateId: string | undefined, enabled: boolean) {
  const route = templateId ? PRESET_ROUTES[templateId] : undefined;
  const [loaded, setLoaded] = useState<{ key: string; areas: PresetArea[] } | null>(null);
  const key = `${sceneId}:${mapImage}`;
  useEffect(() => {
    if (!enabled || !route || !sceneId || !mapImage) return;
    let active = true;
    api.presetScene(route, sceneId)
      .then(preset => { if (active) setLoaded({ key, areas: preset?.areas ?? [] }); })
      .catch(() => { if (active) setLoaded({ key, areas: [] }); });
    return () => { active = false; };
  }, [enabled, route, sceneId, mapImage, key]);
  return enabled && loaded?.key === key ? loaded.areas : [];
}

const ACCENT = '#ba3526';
const INK = '#20221e';
const MUTED = '#62645c';

interface MarkerProps {
  area: PresetArea;
  x: number;
  y: number;
  /** Board zoom: markers keep one screen size. */
  scale: number;
  active: boolean;
  /** Marked explored in the story route: drawn quieter so the rooms still to visit stand out. */
  explored?: boolean;
  listening: boolean;
  onOpen: () => void;
}

/** A DM-only ring over a room label printed on the map; click it to read the room. */
function RoomMarkerShape({ area, x, y, scale, active, explored = false, listening, onOpen }: MarkerProps) {
  const [hover, setHover] = useState(false);
  const open = (event: { cancelBubble: boolean }) => { event.cancelBubble = true; onOpen(); };
  return <Group name="room-marker" x={x} y={y} scaleX={1 / scale} scaleY={1 / scale} listening={listening}
    onMouseEnter={event => { setHover(true); const stage = event.target.getStage(); if (stage) stage.container().style.cursor = 'pointer'; }}
    onMouseLeave={event => { setHover(false); const stage = event.target.getStage(); if (stage) stage.container().style.cursor = ''; }}
    onMouseDown={event => { event.cancelBubble = true; }}
    onTouchStart={event => { event.cancelBubble = true; }}
    onClick={open} onTap={open}>
    <Circle radius={15} fill={active || hover ? 'rgba(186,53,38,0.18)' : explored ? 'rgba(98,100,92,0.10)' : 'rgba(186,53,38,0.06)'} stroke={explored && !active ? MUTED : ACCENT} strokeWidth={active ? 3 : 1.5} dash={active ? undefined : [4, 3]} />
    {explored && !active && <Text text="✓" x={-5} y={-6} fontSize={12} fontStyle="bold" fill={MUTED} listening={false} />}
    {(hover || active) && <Label y={-19} listening={false}>
      <Tag fill={INK} pointerDirection="down" pointerWidth={8} pointerHeight={4} cornerRadius={2} listening={false} />
      <Text text={areaTitle(area)} fontSize={12} padding={5} fill="#ffffff" listening={false} />
    </Label>}
  </Group>;
}

export const RoomMarker = memo(RoomMarkerShape);

/** The open room's description, in the same place as a map note's card. */
interface CardProps {
  area: PresetArea;
  onClose: () => void;
  /** Flies the camera to the room again. */
  onLocate?: () => void;
  /** Brings every player's view to the room, with a ping. */
  onPull?: () => void;
  explored?: boolean;
  onExplored?: (explored: boolean) => void;
}

export function RoomCard({ area, onClose, onLocate, onPull, explored = false, onExplored }: CardProps) {
  const located = !!area.positions?.length;
  return <section className="map-note-card room-note-card" aria-label={`房间描述：${areaTitle(area)}`}>
    <header><strong>{areaTitle(area)}</strong><span className="map-note-visibility">仅 DM</span><button type="button" aria-label="关闭" onClick={onClose}>✕</button></header>
    <div className="map-note-text room-note-text">{area.text}</div>
    {(located || onExplored) && <footer className="room-note-actions">
      {located && onLocate && <button type="button" className="btn-xs" onClick={onLocate} title="把镜头移到这个房间">定位</button>}
      {located && onPull && <button type="button" className="btn-xs" onClick={onPull} title="在房间处标记，并把所有玩家的视角移过来">带玩家过去</button>}
      {onExplored && <label className="map-note-check"><input type="checkbox" checked={explored} onChange={event => onExplored(event.target.checked)} />已探索</label>}
    </footer>}
  </section>;
}

interface ListProps {
  areas: PresetArea[];
  openKey: string | null;
  /** Keys the story route marks explored. */
  explored?: ReadonlySet<string>;
  showMarkers: boolean;
  onShowMarkers: (show: boolean) => void;
  onOpen: (key: string) => void;
}

/** Every room on this map, with or without a marker, plus the scene's own sections. Opens with each new map. */
export function RoomList({ areas, openKey, explored, showMarkers, onShowMarkers, onOpen }: ListProps) {
  const [expanded, setExpanded] = useState(true);
  const [query, setQuery] = useState('');
  const rooms = areas.filter(isRoom);
  const located = rooms.filter(area => area.positions?.length).length;
  const exploredCount = explored ? rooms.filter(area => explored.has(area.key)).length : 0;
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (area: PresetArea) => words.every(word => `${area.key} ${area.name} ${area.text}`.toLocaleLowerCase().includes(word));
  const shownRooms = rooms.filter(matches), sections = areas.filter(area => !isRoom(area) && matches(area));
  const item = (area: PresetArea) => <li key={area.key}><button type="button" aria-current={openKey === area.key ? 'true' : undefined} onClick={() => onOpen(area.key)}>
    {explored?.has(area.key) && <span className="room-notes-done" aria-label="已探索">✓</span>}{areaTitle(area)}{isRoom(area) && !area.positions?.length && <span className="room-notes-unplaced" title="地图上没有找到这个编号">未标</span>}
  </button></li>;
  if (!expanded) return <div className="room-notes is-collapsed">
    <button type="button" className="room-notes-toggle" aria-expanded="false" onClick={() => setExpanded(true)}>房间描述 · {rooms.length || areas.length}</button>
  </div>;
  return <section className="room-notes" aria-label="本地图的房间描述">
    <header>
      <strong>房间描述</strong>
      <span className="text-faint">{rooms.length ? `${rooms.length} 间 · 标出 ${located}${exploredCount ? ` · 已探索 ${exploredCount}` : ''}` : `${areas.length} 条场景要点`}</span>
      <button type="button" aria-label="收起房间描述" aria-expanded="true" onClick={() => setExpanded(false)}>–</button>
    </header>
    {located > 0 && <label className="map-note-check"><input type="checkbox" checked={showMarkers} onChange={event => onShowMarkers(event.target.checked)} />在地图上标出房间（点列表飞过去）</label>}
    <input className="field-sm" aria-label="搜索房间" placeholder="编号、名称或关键词" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="room-notes-scroll">
      {shownRooms.length > 0 && <ul>{shownRooms.map(item)}</ul>}
      {sections.length > 0 && <details open={!rooms.length || words.length > 0}><summary>本场要点（{sections.length}）</summary><ul>{sections.map(item)}</ul></details>}
      {!shownRooms.length && !sections.length && <p className="text-faint">没有符合条件的条目。</p>}
    </div>
  </section>;
}
