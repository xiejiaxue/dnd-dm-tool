import { memo, useEffect, useState } from 'react';
import { Circle, Group, Label, Tag, Text } from 'react-konva';
import type { PresetArea } from '../../../shared/encounter-presets';
import { api } from '../api';

/** Campaign templates whose maps carry keyed room notes, and the DM route that serves a scene's preset. */
const PRESET_ROUTES: Record<string, string> = {
  'curse-of-strahd': 'strahd-scene',
  'curse-of-strahd-remix': 'strahd-remix-scene',
  'lost-mine-of-phandelver': 'phandelver-scene',
  'hoard-of-the-dragon-queen': 'hoard-scene',
  'hoard-of-the-dragon-queen-remix': 'hoard-remix-scene',
};

/** Rooms are keyed by their map label (K7, N2a, 12); `a01`… are the scene's own v2 sections. */
export const isRoom = (area: PresetArea) => !/^a\d+$/.test(area.key);
const title = (area: PresetArea) => /^\d+$/.test(area.key) ? `${area.key}. ${area.name}` : area.name;

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

interface MarkerProps {
  area: PresetArea;
  x: number;
  y: number;
  /** Board zoom: markers keep one screen size. */
  scale: number;
  active: boolean;
  listening: boolean;
  onOpen: () => void;
}

/** A DM-only ring over a room label printed on the map; click it to read the room. */
function RoomMarkerShape({ area, x, y, scale, active, listening, onOpen }: MarkerProps) {
  const [hover, setHover] = useState(false);
  const open = (event: { cancelBubble: boolean }) => { event.cancelBubble = true; onOpen(); };
  return <Group name="room-marker" x={x} y={y} scaleX={1 / scale} scaleY={1 / scale} listening={listening}
    onMouseEnter={event => { setHover(true); const stage = event.target.getStage(); if (stage) stage.container().style.cursor = 'pointer'; }}
    onMouseLeave={event => { setHover(false); const stage = event.target.getStage(); if (stage) stage.container().style.cursor = ''; }}
    onMouseDown={event => { event.cancelBubble = true; }}
    onTouchStart={event => { event.cancelBubble = true; }}
    onClick={open} onTap={open}>
    <Circle radius={15} fill={active || hover ? 'rgba(186,53,38,0.18)' : 'rgba(186,53,38,0.06)'} stroke={ACCENT} strokeWidth={active ? 3 : 1.5} dash={active ? undefined : [4, 3]} />
    {(hover || active) && <Label y={-19} listening={false}>
      <Tag fill={INK} pointerDirection="down" pointerWidth={8} pointerHeight={4} cornerRadius={2} listening={false} />
      <Text text={title(area)} fontSize={12} padding={5} fill="#ffffff" listening={false} />
    </Label>}
  </Group>;
}

export const RoomMarker = memo(RoomMarkerShape);

/** The open room's description, in the same place as a map note's card. */
export function RoomCard({ area, onClose }: { area: PresetArea; onClose: () => void }) {
  return <section className="map-note-card room-note-card" aria-label={`房间描述：${title(area)}`}>
    <header><strong>{title(area)}</strong><span className="map-note-visibility">仅 DM</span><button type="button" aria-label="关闭" onClick={onClose}>✕</button></header>
    <div className="map-note-text room-note-text">{area.text}</div>
  </section>;
}

interface ListProps {
  areas: PresetArea[];
  openKey: string | null;
  showMarkers: boolean;
  onShowMarkers: (show: boolean) => void;
  onOpen: (key: string) => void;
}

/** Every room on this map, with or without a marker, plus the scene's own sections. Opens with each new map. */
export function RoomList({ areas, openKey, showMarkers, onShowMarkers, onOpen }: ListProps) {
  const [expanded, setExpanded] = useState(true);
  const [query, setQuery] = useState('');
  const rooms = areas.filter(isRoom);
  const located = rooms.filter(area => area.positions?.length).length;
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = (area: PresetArea) => words.every(word => `${area.key} ${area.name} ${area.text}`.toLocaleLowerCase().includes(word));
  const shownRooms = rooms.filter(matches), sections = areas.filter(area => !isRoom(area) && matches(area));
  const item = (area: PresetArea) => <li key={area.key}><button type="button" aria-current={openKey === area.key ? 'true' : undefined} onClick={() => onOpen(area.key)}>
    {title(area)}{isRoom(area) && !area.positions?.length && <span className="room-notes-unplaced" title="地图上没有找到这个编号">未标</span>}
  </button></li>;
  if (!expanded) return <div className="room-notes is-collapsed">
    <button type="button" className="room-notes-toggle" aria-expanded="false" onClick={() => setExpanded(true)}>房间描述 · {rooms.length || areas.length}</button>
  </div>;
  return <section className="room-notes" aria-label="本地图的房间描述">
    <header>
      <strong>房间描述</strong>
      <span className="text-faint">{rooms.length ? `${rooms.length} 间 · 地图上标出 ${located} 间` : `${areas.length} 条场景要点`}</span>
      <button type="button" aria-label="收起房间描述" aria-expanded="true" onClick={() => setExpanded(false)}>–</button>
    </header>
    {located > 0 && <label className="map-note-check"><input type="checkbox" checked={showMarkers} onChange={event => onShowMarkers(event.target.checked)} />在地图上标出房间（点圈看描述）</label>}
    <input className="field-sm" aria-label="搜索房间" placeholder="编号、名称或关键词" value={query} onChange={event => setQuery(event.target.value)} />
    <div className="room-notes-scroll">
      {shownRooms.length > 0 && <ul>{shownRooms.map(item)}</ul>}
      {sections.length > 0 && <details open={!rooms.length || words.length > 0}><summary>本场要点（{sections.length}）</summary><ul>{sections.map(item)}</ul></details>}
      {!shownRooms.length && !sections.length && <p className="text-faint">没有符合条件的条目。</p>}
    </div>
  </section>;
}
