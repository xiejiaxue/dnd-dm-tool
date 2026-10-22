import { Stage, Layer, Rect, Line, Image as KImage, Group, Circle, Text } from 'react-konva';
import Konva from 'konva';
import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useScene, getMySessionId } from '../ws';
import { useImage } from '../useImage';
import { DEFAULT_TOKEN_SIZE } from '../types';
import type { PendingToken } from '../pending';
import BoardTokenLayer from '../features/board/BoardTokenLayer';
import FogOverlay from '../features/board/FogOverlay';
import { fogPointAt, fogRectBetween, snapCoordinate } from '../features/board/geometry';
import { useBoardView } from '../features/board/useBoardView';
import { api } from '../api';
import type { MapNote } from '../types';
import type { PendingMapNote } from '../features/journal/mapNotePlacement';
import { openJournal } from '../documents/navigation';
import TokenHud from '../features/board/TokenHud';
import { tokensInsideRect, type SelectionRect } from '../features/board/selection';
import type { Op } from '../types';
import type { HistoryEntry } from '../features/history/useCommandHistory';
import {
  isPlaceableSelected,
  mergePlaceables,
  notesInsideRect,
  selectPlaceable,
  wallsInsideRect,
  type PlaceableRef,
} from '../features/board/placeables';

interface Props {
  tool: string;
  pending: PendingToken | null;
  pendingNote: PendingMapNote | null;
  onClearPending: () => void;
  onClearPendingNote: () => void;
  selectedPlaceables: readonly PlaceableRef[];
  onSelectionChange: (refs: PlaceableRef[]) => void;
  onPerformOps: (label: string, operations: Op[]) => void;
  onRecordHistory: (entry: HistoryEntry) => void;
  presentation?: boolean;
}

export default function BoardCanvas({ tool, pending, pendingNote, onClearPending, onClearPendingNote, selectedPlaceables,
  onSelectionChange, onPerformOps, onRecordHistory, presentation = false }: Props) {
  const { scene, role, encounter } = useScene();
  const mySessionId = getMySessionId();
  const stageRef = useRef<Konva.Stage>(null);
  const { scale, pos, setPosition, zoomAt, zoomCenter, resetView, handleWheel } = useBoardView(stageRef, scene?.id, scene?.initialView);
  // Consecutive map-calibration clicks must compose locally instead of waiting
  // for a server snapshot to update the callback's `scene` closure.
  const [localMapScale, setLocalMapScale] = useState<number | null>(null);
  const localMapScaleRef = useRef<number | null>(null);
  // Konva copies layers through internal canvases as soon as an image-backed
  // node is mounted. A 0x0 first frame therefore throws before ResizeObserver
  // can report the real flex-item size (most visible after restoring tokens
  // with avatars). Keep the bootstrap surface valid and replace it on the
  // first layout measurement below.
  const [stageSize, setStageSize] = useState({ width: 1, height: 1 });
  // Live preview line while dragging the wall tool: [x1, y1, x2, y2].
  const [wallPreview, setWallPreview] = useState<[number, number, number, number] | null>(null);
  const wallStart = useRef<[number, number] | null>(null);
  const wallEnd = useRef<{ x: number; y: number } | null>(null);
  // Fog eraser marquee in original-map coordinates. Keeping this separate from
  // viewport and map scale makes every drag edge pixel-precise and persistent.
  const [fogPreview, setFogPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const fogStart = useRef<{ x: number; y: number } | null>(null);
  const fogEnd = useRef<{ x: number; y: number } | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const [mapNotes, setMapNotes] = useState<MapNote[]>([]);
  const [selectionPreview, setSelectionPreview] = useState<SelectionRect | null>(null);
  const selectionStart = useRef<{ x: number; y: number } | null>(null);
  const selectionEnd = useRef<{ x: number; y: number } | null>(null);
  const [hudPlaceable, setHudPlaceable] = useState<PlaceableRef | null>(null);
  const [floatingHp, setFloatingHp] = useState<Array<{ id: string; tokenId: string; text: string; color: string }>>([]);
  const selectedIds = selectedPlaceables.filter(ref => ref.kind === 'token').map(ref => ref.id);

  const refreshMapNotes = useCallback(async (sceneId: string) => {
    try { setMapNotes(await api.sceneNotes(sceneId)); }
    catch { setMapNotes([]); }
  }, []);

  useEffect(() => {
    if (!scene?.id) { setMapNotes([]); return; }
    let active = true;
    api.sceneNotes(scene.id).then(notes => { if (active) setMapNotes(notes); }).catch(() => { if (active) setMapNotes([]); });
    return () => { active = false; };
  }, [scene?.id]);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ tokenIds?: unknown; text?: unknown; color?: unknown }>).detail;
      if (!Array.isArray(detail?.tokenIds) || typeof detail.text !== 'string' || typeof detail.color !== 'string') return;
      const created = detail.tokenIds.flatMap(tokenId => typeof tokenId === 'string'
        ? [{ id: crypto.randomUUID(), tokenId, text: detail.text as string, color: detail.color as string }]
        : []);
      setFloatingHp(current => [...current, ...created]);
      window.setTimeout(() => setFloatingHp(current => current.filter(item => !created.some(entry => entry.id === item.id))), 1_600);
    };
    window.addEventListener('dndboard:hp-floating-text', receive);
    return () => window.removeEventListener('dndboard:hp-floating-text', receive);
  }, []);

  // Size the Konva surface from its actual flex item instead of subtracting
  // hard-coded viewport chrome. This keeps the board above the filing footer
  // (and handles panel/viewport changes without making the footer overlap).
  // The first render may still be waiting for the room snapshot, in which
  // case the loading branch below does not mount boardRef. Re-run once the
  // active scene appears (and after scene switches) so Konva never remains at
  // its initial 0x0 size.
  useLayoutEffect(() => {
    const element = boardRef.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setStageSize({ width: Math.max(0, Math.floor(width)), height: Math.max(0, Math.floor(height)) });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [scene?.id]);

  // Leaving wall mode cancels any in-progress wall line.
  useEffect(() => {
    if (tool !== 'wall') {
      wallStart.current = null;
      wallEnd.current = null;
      setWallPreview(null);
    }
  }, [tool]);

  useEffect(() => {
    if (tool !== 'multi') {
      selectionStart.current = null;
      selectionEnd.current = null;
      setSelectionPreview(null);
    }
  }, [tool]);

  // Leaving erase mode cancels an unfinished marquee.
  useEffect(() => {
    if (tool !== 'erase') {
      fogStart.current = null;
      fogEnd.current = null;
      setFogPreview(null);
    }
  }, [tool]);

  const map = useImage(scene?.mapImage ? scene.mapImage : null);

  useEffect(() => {
    const authoritative = scene?.mapScale ?? 1;
    const local = localMapScaleRef.current;
    if (local === null || Math.abs(local - authoritative) > 0.0001) return;
    localMapScaleRef.current = null;
    setLocalMapScale(null);
  }, [scene?.mapScale]);

  // Convert a container-space pointer to world coordinates (unaffected by pan/zoom).
  const worldPos = useCallback((): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    return stage.getRelativePointerPosition();
  }, []);

  // Snap a world coordinate onto the grid (axis 0 = x, 1 = y).
  const snap = useCallback((v: number, axis: 0 | 1): number => {
    if (!scene) return v;
    return snapCoordinate(v, scene.grid, axis);
  }, [scene]);

  const currentFogPoint = useCallback(() => {
    if (!scene) return null;
    const pointer = worldPos();
    if (!pointer) return null;
    const displayedMapScale = localMapScaleRef.current ?? scene.mapScale ?? 1;
    return fogPointAt(scene, pointer.x, pointer.y, displayedMapScale);
  }, [scene, worldPos]);

  // Map-image calibration: scale the map (NOT the tokens/grid) so a hand-drawn
  // map's cells line up with the grid. Sent as an op so it persists per scene.
  const adjustMapScale = useCallback((factor: number) => {
    if (!scene) return;
    const cur = localMapScaleRef.current ?? scene.mapScale ?? 1;
    const next = Math.min(8, Math.max(0.1, Math.round(cur * factor * 100) / 100));
    if (next !== cur) {
      localMapScaleRef.current = next;
      setLocalMapScale(next);
      onPerformOps('调整地图比例', [{ op: 'updateMapScale', mapScale: next }]);
    }
  }, [onPerformOps, scene]);

  const setMapScale = useCallback((value: number) => {
    if (!scene) return;
    const clamped = Math.min(8, Math.max(0.1, value));
    if (clamped !== (localMapScaleRef.current ?? scene.mapScale ?? 1)) {
      localMapScaleRef.current = clamped;
      setLocalMapScale(clamped);
      onPerformOps('设置地图比例', [{ op: 'updateMapScale', mapScale: clamped }]);
    }
  }, [onPerformOps, scene]);

  // Erase tool: press establishes one marquee corner in map coordinates.
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'multi' && role === 'dm' && e.target === stageRef.current) {
      const point = worldPos();
      if (point) {
        selectionStart.current = point;
        selectionEnd.current = point;
        setSelectionPreview({ ...point, w: 0, h: 0 });
      }
      return;
    }
    if (tool === 'erase' && role === 'dm') {
      const point = currentFogPoint();
      if (point) {
        fogStart.current = point;
        fogEnd.current = point;
        setFogPreview({ ...point, w: 0, h: 0 });
      }
      return;
    }
    if (tool !== 'wall' || !scene || e.target !== stageRef.current) return;
    const p = worldPos();
    if (!p) return;
    wallStart.current = [snap(p.x, 0), snap(p.y, 1)];
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], wallStart.current[0], wallStart.current[1]]);
  }, [tool, role, scene, worldPos, snap, currentFogPoint]);

  // Erase tool: dragging updates a non-destructive preview. The room is mutated
  // only once, on pointer release.
  const handleMouseMove = useCallback(() => {
    if (tool === 'multi' && role === 'dm') {
      if (!selectionStart.current) return;
      const point = worldPos();
      if (point) {
        selectionEnd.current = point;
        setSelectionPreview(rectBetween(selectionStart.current, point));
      }
      return;
    }
    if (tool === 'erase' && role === 'dm') {
      if (!fogStart.current) return;
      const point = currentFogPoint();
      if (point) {
        fogEnd.current = point;
        setFogPreview(fogRectBetween(fogStart.current, point) ?? { ...fogStart.current, w: 0, h: 0 });
      }
      return;
    }
    if (tool !== 'wall' || !wallStart.current) return;
    const p = worldPos();
    if (!p) return;
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], p.x, p.y]);
  }, [tool, role, worldPos, currentFogPoint]);

  const finishWall = useCallback(() => {
    if (tool !== 'wall' || !wallStart.current || !scene) return;
    const start = wallStart.current;
    const end: [number, number] = wallEnd.current
      ? [snap(wallEnd.current.x, 0), snap(wallEnd.current.y, 1)]
      : start;
    if (end[0] !== start[0] || end[1] !== start[1]) {
      onPerformOps('建立墙体', [{ op: 'addWall', wall: { id: `wall-${crypto.randomUUID()}`, p1: start, p2: end } }]);
    }
    wallStart.current = null;
    wallEnd.current = null;
    setWallPreview(null);
  }, [tool, scene, snap, onPerformOps]);

  const finishWallRef = useRef(finishWall);
  finishWallRef.current = finishWall;

  const finishFogBox = useCallback(() => {
    if (tool !== 'erase' || role !== 'dm' || !fogStart.current || !fogEnd.current) return;
    const rect = fogRectBetween(fogStart.current, fogEnd.current);
    fogStart.current = null;
    fogEnd.current = null;
    setFogPreview(null);
    if (rect) onPerformOps('擦除战争迷雾', [{ op: 'revealFogRect', rect }]);
  }, [tool, role, onPerformOps]);

  const finishFogBoxRef = useRef(finishFogBox);
  finishFogBoxRef.current = finishFogBox;

  const finishSelection = useCallback((additive = false) => {
    if (!scene || tool !== 'multi' || !selectionStart.current || !selectionEnd.current) return;
    const rect = rectBetween(selectionStart.current, selectionEnd.current);
    selectionStart.current = null;
    selectionEnd.current = null;
    setSelectionPreview(null);
    if (rect.w < 2 && rect.h < 2) {
      if (!additive) onSelectionChange([]);
      return;
    }
    const inside: PlaceableRef[] = [
      ...tokensInsideRect([...scene.tokens, ...scene.players], rect).map(id => ({ kind: 'token' as const, id })),
      ...wallsInsideRect(scene.walls, rect),
      ...notesInsideRect(mapNotes, rect),
    ];
    onSelectionChange(mergePlaceables(selectedPlaceables, inside, additive));
    setHudPlaceable(null);
  }, [scene, tool, mapNotes, selectedPlaceables, onSelectionChange]);

  const finishSelectionRef = useRef(finishSelection);
  finishSelectionRef.current = finishSelection;
  useEffect(() => {
    if (tool !== 'multi') return;
    const onUp = (event: MouseEvent) => finishSelectionRef.current(event.shiftKey || event.metaKey || event.ctrlKey);
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [tool]);

  // Finalize the wall even if the pointer is released outside the Stage.
  useEffect(() => {
    if (tool !== 'wall') return;
    const onUp = () => finishWallRef.current();
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [tool]);

  // Finalize the fog marquee even if the pointer is released outside Stage.
  useEffect(() => {
    if (tool !== 'erase') return;
    const onUp = () => finishFogBoxRef.current();
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [tool]);

  // Empty-canvas click: zoom tool zooms, add tool places the pending token,
  // select tool deselects.
  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!scene || e.target !== stageRef.current) return;
    if (tool === 'multi') return;
    if (tool === 'zoom') {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) zoomAt(pointer, e.evt.shiftKey ? 0.8 : 1.25);
      return;
    }
    if (tool === 'note' && pendingNote && role === 'dm') {
      const p = worldPos();
      if (!p) return;
      const input = {
        journalId: pendingNote.journalId,
        pageId: pendingNote.pageId,
        x: p.x,
        y: p.y,
        label: pendingNote.label,
        icon: pendingNote.icon,
        visibility: pendingNote.visibility,
      };
      void api.createSceneNote(scene.id, input).then(note => {
        let noteId = note.id;
        setMapNotes(current => [...current.filter(item => item.id !== note.id), note]);
        onRecordHistory({
          label: '放置地图标记',
          undo: async () => {
            await api.deleteSceneNote(scene.id, noteId);
            await refreshMapNotes(scene.id);
          },
          redo: async () => {
            const restored = await api.createSceneNote(scene.id, input);
            noteId = restored.id;
            await refreshMapNotes(scene.id);
          },
        });
        onClearPendingNote();
      }).catch(error => console.warn('[map-note]', error));
      return;
    }
    if (tool === 'add' && pending && role === 'dm') {
      const p = worldPos();
      if (!p) return;
      const sx = snap(p.x, 0);
      const sy = snap(p.y, 1);
      const token = {
          id: `token-${crypto.randomUUID()}`,
          kind: pending.kind,
          actorId: pending.actorId ?? null,
          name: pending.name,
          entryId: pending.entryId,
          x: sx,
          y: sy,
          size: pending.size ?? DEFAULT_TOKEN_SIZE,
          avatar: pending.avatar,
          color: pending.color,
          hidden: Boolean(pending.hidden || e.evt.shiftKey),
          hpVisibility: pending.hpVisibility ?? 'value',
          ...(pending.hp ? { hp: { ...pending.hp } } : {}),
        };
      onPerformOps('放置 Token', pending.kind === 'player'
        ? [{ op: 'addPlayer', player: { ...token, kind: 'player', sessionId: null } }]
        : [{ op: 'addToken', token: { ...token, kind: pending.kind } }]);
      onClearPending();
    } else {
      onSelectionChange([]);
      setHudPlaceable(null);
    }
  }, [tool, pending, pendingNote, role, scene, worldPos, snap, onClearPending, onClearPendingNote,
    onSelectionChange, onPerformOps, onRecordHistory, refreshMapNotes, zoomAt]);

  const renderMapNote = (note: MapNote) => (
    <Group
      key={note.id}
      x={note.x}
      y={note.y}
      draggable={role === 'dm' && tool === 'select'}
      onClick={event => {
        event.cancelBubble = true;
        if (role === 'dm') {
          onSelectionChange(selectPlaceable(selectedPlaceables, { kind: 'note', id: note.id }, Boolean(event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey)));
          setHudPlaceable(null);
        } else openJournal({ journalId: note.journalId, pageId: note.pageId });
      }}
      onDblClick={event => {
        event.cancelBubble = true;
        openJournal({ journalId: note.journalId, pageId: note.pageId });
      }}
      onTap={event => {
        event.cancelBubble = true;
        openJournal({ journalId: note.journalId, pageId: note.pageId });
      }}
      onDragEnd={event => {
        if (role !== 'dm' || !scene) return;
        const x = event.target.x();
        const y = event.target.y();
        setMapNotes(current => current.map(item => item.id === note.id ? { ...item, x, y } : item));
        void api.updateSceneNote(scene.id, note.id, { x, y }).then(() => {
          onRecordHistory({
            label: '移动地图标记',
            undo: async () => { await api.updateSceneNote(scene.id, note.id, { x: note.x, y: note.y }); await refreshMapNotes(scene.id); },
            redo: async () => { await api.updateSceneNote(scene.id, note.id, { x, y }); await refreshMapNotes(scene.id); },
          });
        }).catch(error => { console.warn('[map-note]', error); void refreshMapNotes(scene.id); });
      }}
      onContextMenu={event => {
        event.evt.preventDefault();
        event.cancelBubble = true;
        if (role !== 'dm') return;
        if (!isPlaceableSelected(selectedPlaceables, 'note', note.id)) onSelectionChange([{ kind: 'note', id: note.id }]);
        setHudPlaceable({ kind: 'note', id: note.id });
      }}
    >
      <Circle radius={13} fill="#312e81" stroke={isPlaceableSelected(selectedPlaceables, 'note', note.id) ? '#fbbf24' : '#a78bfa'}
        strokeWidth={isPlaceableSelected(selectedPlaceables, 'note', note.id) ? 4 / scale : 2 / scale} shadowColor="#000" shadowBlur={5} />
      <Text text="N" x={-7} y={-8} width={14} align="center" fill="#ede9fe" fontSize={13} fontStyle="bold" listening={false} />
      <Text text={note.label} x={-60} y={17} width={120} align="center" fill="#ddd6fe" fontSize={11} fontStyle="bold" listening={false} />
    </Group>
  );

  // Unified Placeable deletion. Initiative membership is intentionally not the
  // same action as deleting a Token; the inverse command restores both only
  // when a map Token itself is deleted.
  const handleDelete = useCallback(() => {
    if (!selectedPlaceables.length || role !== 'dm' || !scene) return;
    const operations = selectedPlaceables.reduce<Op[]>((result, ref) => {
      if (ref.kind === 'wall') result.push({ op: 'removeWall', wallId: ref.id });
      else if (ref.kind === 'token' && scene.tokens.some(token => token.id === ref.id)) result.push({ op: 'removeToken', tokenId: ref.id });
      else if (ref.kind === 'token' && scene.players.some(player => player.id === ref.id)) result.push({ op: 'removePlayer', tokenId: ref.id });
      return result;
    }, []);
    if (operations.length) onPerformOps('删除所选地图对象', operations);
    const notes = selectedPlaceables.flatMap(ref => ref.kind === 'note'
      ? mapNotes.filter(note => note.id === ref.id)
      : []);
    if (notes.length) {
      let noteIds = notes.map(note => note.id);
      void Promise.all(noteIds.map(id => api.deleteSceneNote(scene.id, id))).then(async () => {
        await refreshMapNotes(scene.id);
        onRecordHistory({
          label: `删除 ${notes.length} 个地图标记`,
          undo: async () => {
            const restored = await Promise.all(notes.map(note => api.createSceneNote(scene.id, {
              journalId: note.journalId, pageId: note.pageId, x: note.x, y: note.y,
              label: note.label, icon: note.icon, visibility: note.visibility,
            })));
            noteIds = restored.map(note => note.id);
            await refreshMapNotes(scene.id);
          },
          redo: async () => {
            await Promise.all(noteIds.map(id => api.deleteSceneNote(scene.id, id)));
            await refreshMapNotes(scene.id);
          },
        });
      }).catch(error => console.warn('[map-note]', error));
    }
    onSelectionChange([]);
    setHudPlaceable(null);
  }, [selectedPlaceables, role, scene, mapNotes, onPerformOps, onRecordHistory, onSelectionChange, refreshMapNotes]);

  // Delete key removes the selected token (skip when typing in an input).
  const handleDeleteRef = useRef(handleDelete);
  handleDeleteRef.current = handleDelete;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.key === 'Escape') {
        setHudPlaceable(null);
        onSelectionChange([]);
        return;
      }
      if (e.key !== 'Delete') return;
      handleDeleteRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelectionChange]);

  if (!scene) return <div className="absolute inset-0 flex items-center justify-center text-zinc-600">连接中…</div>;

  const grid = scene.grid;
  const area = scene.playArea;
  const displayedMapScale = localMapScale ?? scene.mapScale ?? 1;

  return (
    <div ref={boardRef} className="relative h-full min-h-0 w-full overflow-hidden">
    <Stage
      ref={stageRef}
      width={Math.max(1, stageSize.width)}
      height={Math.max(1, stageSize.height)}
      scaleX={scale} scaleY={scale} x={pos.x} y={pos.y}
      onWheel={handleWheel}
      // The Stage stays non-draggable while drawing (wall) or erasing so that
      // mousemove fires on every pointer move instead of being captured by a
      // drag — same pattern the wall tool uses for its live preview.
      draggable={tool !== 'wall' && tool !== 'erase' && tool !== 'note' && tool !== 'multi'}
      onDragEnd={(e) => {
        // Konva bubbles dragend from dragged children (tokens) up to the Stage;
        // only update the pan position when the Stage itself was the drag target.
        if (e.target === stageRef.current) setPosition({ x: e.target.x(), y: e.target.y() });
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={(event) => {
        finishWall();
        finishFogBox();
        finishSelection(Boolean(event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey));
      }}
      onClick={handleClick}
      className={tool === 'add' || tool === 'wall' || tool === 'erase' || tool === 'note' || tool === 'multi' ? 'cursor-crosshair' : tool === 'zoom' ? 'cursor-zoom-in' : 'cursor-grab'}
    >
      <Layer>
        {map && (
          <KImage
            image={map}
            x={0} y={0}
            width={scene.mapSize[0] * displayedMapScale}
            height={scene.mapSize[1] * displayedMapScale}
            listening={false}
          />
        )}
        {scene.mapImage && !map && <Rect width={area.w} height={area.h} fill="#262932" listening={false} />}
        {/* Walls participate in the same Placeable selection and command path
            as Tokens and map notes. */}
        {scene.walls.map(w => (
          <Line key={w.id} points={[w.p1[0], w.p1[1], w.p2[0], w.p2[1]]}
            stroke={isPlaceableSelected(selectedPlaceables, 'wall', w.id) ? '#fbbf24' : '#111827'}
            strokeWidth={isPlaceableSelected(selectedPlaceables, 'wall', w.id) ? 12 : 10}
            hitStrokeWidth={20 / scale} lineCap="round" lineJoin="round"
            listening={role === 'dm' && tool !== 'wall' && tool !== 'erase' && tool !== 'note'}
            draggable={role === 'dm' && tool === 'select'}
            onClick={event => {
              event.cancelBubble = true;
              onSelectionChange(selectPlaceable(selectedPlaceables, { kind: 'wall', id: w.id }, Boolean(event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey)));
              setHudPlaceable(null);
            }}
            onContextMenu={event => {
              event.evt.preventDefault();
              event.cancelBubble = true;
              if (!isPlaceableSelected(selectedPlaceables, 'wall', w.id)) onSelectionChange([{ kind: 'wall', id: w.id }]);
              setHudPlaceable({ kind: 'wall', id: w.id });
            }}
            onDragEnd={event => {
              const dx = event.target.x();
              const dy = event.target.y();
              event.target.position({ x: 0, y: 0 });
              const wallIds = isPlaceableSelected(selectedPlaceables, 'wall', w.id)
                ? selectedPlaceables.filter(ref => ref.kind === 'wall').map(ref => ref.id)
                : [w.id];
              onPerformOps('移动墙体', wallIds.flatMap(id => {
                const wall = scene.walls.find(candidate => candidate.id === id);
                return wall ? [{ op: 'updateWall' as const, wallId: id, patch: {
                  p1: [wall.p1[0] + dx, wall.p1[1] + dy] as [number, number],
                  p2: [wall.p2[0] + dx, wall.p2[1] + dy] as [number, number],
                } }] : [];
              }));
            }} />
        ))}
        {/* Live wall preview while dragging. */}
        {wallPreview && (
          <Line points={[...wallPreview]} stroke="#f59e0b" strokeWidth={3} dash={[8, 8]} lineCap="round" listening={false} />
        )}
        <BoardTokenLayer
          scene={scene}
          encounter={encounter}
          role={role}
          tool={tool}
          selectedIds={selectedIds}
          mySessionId={mySessionId}
          onSelect={(tokenId, additive) => {
            onSelectionChange(selectPlaceable(selectedPlaceables, { kind: 'token', id: tokenId }, additive));
            setHudPlaceable(null);
          }}
          onContextSelect={tokenId => {
            if (!isPlaceableSelected(selectedPlaceables, 'token', tokenId)) onSelectionChange([{ kind: 'token', id: tokenId }]);
            setHudPlaceable({ kind: 'token', id: tokenId });
          }}
          onMoveToken={(tokenId, x, y) => {
            const moved = scene.tokens.find(token => token.id === tokenId) ?? scene.players.find(player => player.id === tokenId);
            if (!moved) return;
            const ids = role === 'dm' && selectedIds.includes(tokenId) ? selectedIds : [tokenId];
            const dx = x - moved.x;
            const dy = y - moved.y;
            const allTokens = [...scene.tokens, ...scene.players];
            onPerformOps('移动 Token', ids.flatMap(id => {
              const token = allTokens.find(candidate => candidate.id === id);
              return token ? [{ op: 'moveToken' as const, tokenId: id, x: token.x + dx, y: token.y + dy }] : [];
            }));
          }}
        />
        {floatingHp.flatMap(item => {
          const token = scene.tokens.find(entry => entry.id === item.tokenId) ?? scene.players.find(entry => entry.id === item.tokenId);
          return token ? [<Text key={item.id} text={item.text} x={token.x - 40} y={token.y - token.size / 2 - 36}
            width={80} align="center" fontSize={22} fontStyle="bold" fill={item.color} stroke="#18181b" strokeWidth={3 / scale}
            shadowColor="#000" shadowBlur={6} listening={false} />] : [];
        })}
        {mapNotes.filter(note => note.visibility !== 'all').map(renderMapNote)}
        <FogOverlay scene={scene} role={role} mapScale={displayedMapScale} />
        {mapNotes.filter(note => note.visibility === 'all').map(renderMapNote)}
        {fogPreview && (
          <Rect
            x={fogPreview.x * (scene.mapImage ? displayedMapScale : 1)}
            y={fogPreview.y * (scene.mapImage ? displayedMapScale : 1)}
            width={fogPreview.w * (scene.mapImage ? displayedMapScale : 1)}
            height={fogPreview.h * (scene.mapImage ? displayedMapScale : 1)}
            fill="rgba(16,185,129,0.16)"
            stroke="#34d399"
            strokeWidth={2 / scale}
            dash={[8 / scale, 6 / scale]}
            listening={false}
          />
        )}
        {selectionPreview && (
          <Rect x={selectionPreview.x} y={selectionPreview.y} width={selectionPreview.w} height={selectionPreview.h}
            fill="rgba(251,191,36,0.10)" stroke="#fbbf24" strokeWidth={2 / scale} dash={[8 / scale, 5 / scale]} listening={false} />
        )}
      </Layer>
    </Stage>
    {/* Selected-token action popup (DM only). Must be OUTSIDE the Konva Stage
        (react-konva only accepts Konva nodes as Stage children); the Stage is
        wrapped in a relative container so this HTML overlay tracks the token. */}
    {!presentation && role === 'dm' && hudPlaceable && (() => {
      if (hudPlaceable.kind !== 'token') {
        const wall = hudPlaceable.kind === 'wall' ? scene.walls.find(item => item.id === hudPlaceable.id) : null;
        const note = hudPlaceable.kind === 'note' ? mapNotes.find(item => item.id === hudPlaceable.id) : null;
        if (!wall && !note) return null;
        return <PlaceableHud
          title={wall ? '墙体' : note?.label ?? '地图标记'}
          subtitle={wall ? '可拖动、框选与撤销' : `可见性：${noteVisibilityLabel(note!.visibility)}`}
          onClose={() => setHudPlaceable(null)}
          onDelete={handleDelete}
          onOpen={note ? () => openJournal({ journalId: note.journalId, pageId: note.pageId }) : undefined}
          onCycleVisibility={note ? () => {
            const previous = note.visibility;
            const next = previous === 'gm' ? 'inherit' : previous === 'inherit' ? 'all' : 'gm';
            void api.updateSceneNote(scene.id, note.id, { visibility: next }).then(async () => {
              await refreshMapNotes(scene.id);
              onRecordHistory({
                label: '修改地图标记可见性',
                undo: async () => { await api.updateSceneNote(scene.id, note.id, { visibility: previous }); await refreshMapNotes(scene.id); },
                redo: async () => { await api.updateSceneNote(scene.id, note.id, { visibility: next }); await refreshMapNotes(scene.id); },
              });
            }).catch(error => console.warn('[map-note]', error));
          } : undefined}
        />;
      }
      const sel = scene.tokens.find(t => t.id === hudPlaceable.id) ?? scene.players.find(p => p.id === hudPlaceable.id);
      if (!sel) return null;
      const allTokens = [...scene.tokens, ...scene.players];
      const selectedTokens = selectedIds.flatMap(id => {
        const selected = allTokens.find(token => token.id === id);
        return selected ? [selected] : [];
      });
      return (
        <TokenHud
          token={sel}
          selectedTokens={selectedTokens}
          encounter={encounter}
          style={{
            left: Math.max(150, Math.min(stageSize.width - 150, sel.x * scale + pos.x)),
            top: Math.max(315, sel.y * scale + pos.y - (sel.size / 2) * scale - 6),
          }}
          onClose={() => setHudPlaceable(null)}
          onDelete={handleDelete}
          onPerformOps={onPerformOps}
        />
      );
    })()}
    {/* View zoom controls (all roles): zoom in/out, reset, current percentage. */}
    {!presentation && <div className="absolute bottom-3 right-3 z-20 flex flex-col items-stretch gap-1 bg-zinc-800/90 rounded-lg p-1 shadow-lg shadow-black/40">
      <span className="text-center text-[10px] text-zinc-400 select-none">视图</span>
      <button onClick={() => zoomCenter(1.25)} title="放大" aria-label="放大视图" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">＋</button>
      <button onClick={() => zoomCenter(0.8)} title="缩小" aria-label="缩小视图" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">－</button>
      <button onClick={resetView} title="重置视图" aria-label="重置视图" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-sm leading-none">⟲</button>
      <span className="text-center text-[10px] text-zinc-400 select-none">{Math.round(scale * 100)}%</span>
    </div>}
    {/* Map-image scale (DM only): scales the map to fit the grid while tokens
        keep their size — for calibrating hand-drawn maps. */}
    {/* Fog controls (DM): reveal-all (清空遮罩) and cover-all (添加遮罩), text
        buttons per user request. */}
    {!presentation && role === 'dm' && (
      <div className="absolute bottom-3 left-3 z-20 flex flex-col items-stretch gap-1 bg-zinc-800/90 rounded-lg p-1 shadow-lg shadow-black/40">
        <span className="text-center text-[10px] text-zinc-400 select-none">迷雾</span>
        <button onClick={() => onPerformOps('清空战争迷雾', [{ op: 'revealAllFog' }])}
          className="px-2 py-1 rounded hover:bg-emerald-700/30 text-emerald-400 text-xs">一键清空遮罩</button>
        <button onClick={() => onPerformOps('添加战争迷雾', [{ op: 'coverAllFog' }])}
          className="px-2 py-1 rounded hover:bg-amber-700/30 text-amber-400 text-xs">一键添加遮罩</button>
      </div>
    )}
    {!presentation && role === 'dm' && scene?.mapImage && (
      <div className="absolute bottom-28 left-3 z-20 flex flex-col items-stretch gap-1 bg-zinc-800/90 rounded-lg p-1 shadow-lg shadow-black/40">
        <span className="text-center text-[10px] text-zinc-400 select-none">地图</span>
        <button onClick={() => adjustMapScale(1.1)} title="地图放大" aria-label="放大地图比例" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">＋</button>
        <button onClick={() => adjustMapScale(0.9)} title="地图缩小" aria-label="缩小地图比例" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">－</button>
        <button onClick={() => setMapScale(1)} title="地图重置为 100%" aria-label="重置地图比例" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-sm leading-none">⟲</button>
        <span className="text-center text-[10px] text-zinc-400 select-none">{Math.round(displayedMapScale * 100)}%</span>
      </div>
    )}
  </div>
  );
}

function rectBetween(start: { x: number; y: number }, end: { x: number; y: number }): SelectionRect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

function PlaceableHud({ title, subtitle, onClose, onDelete, onOpen, onCycleVisibility }: {
  title: string;
  subtitle: string;
  onClose(): void;
  onDelete(): void;
  onOpen?: () => void;
  onCycleVisibility?: () => void;
}) {
  return (
    <section aria-label="地图对象快捷操作" className="absolute right-14 top-3 z-30 w-56 overflow-hidden rounded-lg border border-zinc-600 bg-zinc-950/95 text-xs shadow-2xl">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2">
        <div className="min-w-0 flex-1"><div className="truncate font-semibold text-zinc-100">{title}</div><div className="truncate text-[10px] text-zinc-500">{subtitle}</div></div>
        <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-100" aria-label="关闭地图对象快捷操作" title="关闭地图对象快捷操作">×</button>
      </header>
      <div className="flex flex-wrap gap-1 p-2">
        {onOpen && <button type="button" onClick={onOpen} className="rounded bg-sky-500/15 px-2 py-1.5 text-sky-300 hover:bg-sky-500/25">打开文档</button>}
        {onCycleVisibility && <button type="button" onClick={onCycleVisibility} className="rounded bg-violet-500/15 px-2 py-1.5 text-violet-300 hover:bg-violet-500/25">切换可见性</button>}
        <button type="button" onClick={onDelete} className="ml-auto rounded bg-red-500/15 px-2 py-1.5 text-red-300 hover:bg-red-500/25">删除</button>
      </div>
    </section>
  );
}

function noteVisibilityLabel(visibility: MapNote['visibility']): string {
  if (visibility === 'gm') return '仅主持人';
  if (visibility === 'all') return '所有人';
  return '继承文档权限';
}
