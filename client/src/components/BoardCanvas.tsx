import { Stage, Layer, Rect, Line, Image as KImage } from 'react-konva';
import Konva from 'konva';
import { useRef, useState, useCallback, useEffect, useLayoutEffect } from 'react';
import { useScene, connection, getMySessionId } from '../ws';
import { useImage } from '../useImage';
import { DEFAULT_TOKEN_SIZE } from '../types';
import type { PendingToken } from '../pending';
import BoardTokenLayer from '../features/board/BoardTokenLayer';
import FogOverlay from '../features/board/FogOverlay';
import { fogPointAt, fogRectBetween, snapCoordinate } from '../features/board/geometry';
import { useBoardView } from '../features/board/useBoardView';

interface Props {
  tool: string;
  pending: PendingToken | null;
  onClearPending: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Kept for the existing table shell. The board now measures its own content
  // box, so it also reserves space for a visible filing footer.
  queryOpen: boolean;
}

export default function BoardCanvas({ tool, pending, onClearPending, selectedId, onSelect }: Props) {
  const { scene, role } = useScene();
  const mySessionId = getMySessionId();
  const stageRef = useRef<Konva.Stage>(null);
  const { scale, pos, setPosition, zoomAt, zoomCenter, resetView, handleWheel } = useBoardView(stageRef);
  // Consecutive map-calibration clicks must compose locally instead of waiting
  // for a server snapshot to update the callback's `scene` closure.
  const [localMapScale, setLocalMapScale] = useState<number | null>(null);
  const localMapScaleRef = useRef<number | null>(null);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
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
      connection.sendOps([{ op: 'updateMapScale', mapScale: next }]);
    }
  }, [scene]);

  const setMapScale = useCallback((value: number) => {
    if (!scene) return;
    const clamped = Math.min(8, Math.max(0.1, value));
    if (clamped !== (localMapScaleRef.current ?? scene.mapScale ?? 1)) {
      localMapScaleRef.current = clamped;
      setLocalMapScale(clamped);
      connection.sendOps([{ op: 'updateMapScale', mapScale: clamped }]);
    }
  }, [scene]);

  // Erase tool: press establishes one marquee corner in map coordinates.
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
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
      connection.sendOps([{ op: 'addWall', wall: { id: `w${Date.now()}`, p1: start, p2: end } }]);
    }
    wallStart.current = null;
    wallEnd.current = null;
    setWallPreview(null);
  }, [tool, scene, snap]);

  const finishWallRef = useRef(finishWall);
  finishWallRef.current = finishWall;

  const finishFogBox = useCallback(() => {
    if (tool !== 'erase' || role !== 'dm' || !fogStart.current || !fogEnd.current) return;
    const rect = fogRectBetween(fogStart.current, fogEnd.current);
    fogStart.current = null;
    fogEnd.current = null;
    setFogPreview(null);
    if (rect) connection.sendOps([{ op: 'revealFogRect', rect }]);
  }, [tool, role]);

  const finishFogBoxRef = useRef(finishFogBox);
  finishFogBoxRef.current = finishFogBox;

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
    if (tool === 'zoom') {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) zoomAt(pointer, e.evt.shiftKey ? 0.8 : 1.25);
      return;
    }
    if (tool === 'add' && pending && role === 'dm') {
      const p = worldPos();
      if (!p) return;
      const sx = snap(p.x, 0);
      const sy = snap(p.y, 1);
      connection.sendOps([{
        op: 'addToken',
        token: {
          id: `t${Date.now()}`,
          kind: pending.kind,
          name: pending.name,
          entryId: pending.entryId,
          x: sx,
          y: sy,
          size: DEFAULT_TOKEN_SIZE,
          avatar: pending.avatar,
          color: pending.color,
          ...(pending.hp ? { hp: { ...pending.hp } } : {}),
        },
      }]);
      onClearPending();
    } else {
      onSelect(null);
    }
  }, [tool, pending, role, scene, worldPos, snap, onClearPending, onSelect, zoomAt]);

  // Remove the selected token from the map (monster or player token).
  const handleDelete = useCallback(() => {
    if (!selectedId || role !== 'dm' || !scene) return;
    if (scene.tokens.some(t => t.id === selectedId)) {
      connection.sendOps([{ op: 'removeToken', tokenId: selectedId }]);
    } else if (scene.players.some(p => p.id === selectedId)) {
      connection.sendOps([{ op: 'removePlayer', tokenId: selectedId }]);
    }
    onSelect(null);
  }, [selectedId, role, scene, onSelect]);

  // Delete key removes the selected token (skip when typing in an input).
  const handleDeleteRef = useRef(handleDelete);
  handleDeleteRef.current = handleDelete;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      handleDeleteRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!scene) return <div className="absolute inset-0 flex items-center justify-center text-zinc-600">连接中…</div>;

  const grid = scene.grid;
  const area = scene.playArea;
  const displayedMapScale = localMapScale ?? scene.mapScale ?? 1;

  return (
    <div ref={boardRef} className="relative h-full min-h-0 w-full overflow-hidden">
    <Stage
      ref={stageRef}
      width={stageSize.width}
      height={stageSize.height}
      scaleX={scale} scaleY={scale} x={pos.x} y={pos.y}
      onWheel={handleWheel}
      // The Stage stays non-draggable while drawing (wall) or erasing so that
      // mousemove fires on every pointer move instead of being captured by a
      // drag — same pattern the wall tool uses for its live preview.
      draggable={tool !== 'wall' && tool !== 'erase'}
      onDragEnd={(e) => {
        // Konva bubbles dragend from dragged children (tokens) up to the Stage;
        // only update the pan position when the Stage itself was the drag target.
        if (e.target === stageRef.current) setPosition({ x: e.target.x(), y: e.target.y() });
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => {
        finishWall();
        finishFogBox();
      }}
      onClick={handleClick}
      className={tool === 'add' || tool === 'wall' || tool === 'erase' ? 'cursor-crosshair' : tool === 'zoom' ? 'cursor-zoom-in' : 'cursor-grab'}
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
        {/* Existing walls: thick dark lines. */}
        {scene.walls.map(w => (
          <Line key={w.id} points={[w.p1[0], w.p1[1], w.p2[0], w.p2[1]]} stroke="#111827" strokeWidth={10} lineCap="round" lineJoin="round" listening={false} />
        ))}
        {/* Live wall preview while dragging. */}
        {wallPreview && (
          <Line points={[...wallPreview]} stroke="#f59e0b" strokeWidth={3} dash={[8, 8]} lineCap="round" listening={false} />
        )}
        <BoardTokenLayer
          scene={scene}
          role={role}
          tool={tool}
          selectedId={selectedId}
          mySessionId={mySessionId}
          onSelect={onSelect}
          onMoveToken={(tokenId, x, y) => connection.sendOps([{ op: 'moveToken', tokenId, x, y }])}
        />
        <FogOverlay scene={scene} role={role} mapScale={displayedMapScale} />
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
      </Layer>
    </Stage>
    {/* Selected-token action popup (DM only). Must be OUTSIDE the Konva Stage
        (react-konva only accepts Konva nodes as Stage children); the Stage is
        wrapped in a relative container so this HTML overlay tracks the token. */}
    {role === 'dm' && (() => {
      const sel = scene.tokens.find(t => t.id === selectedId) ?? scene.players.find(p => p.id === selectedId);
      if (!sel) return null;
      return (
        <div
          className="absolute z-10"
          style={{
            left: sel.x * scale + pos.x + (sel.size / 2) * scale,
            top: sel.y * scale + pos.y - 4,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <button
            onClick={handleDelete}
            title="删除 token（Delete 键）"
            className="px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30 text-xs shadow-lg shadow-black/40 whitespace-nowrap"
          >🗑 删除</button>
        </div>
      );
    })()}
    {/* View zoom controls (all roles): zoom in/out, reset, current percentage. */}
    <div className="absolute bottom-3 right-3 z-20 flex flex-col items-stretch gap-1 bg-zinc-800/90 rounded-lg p-1 shadow-lg shadow-black/40">
      <button onClick={() => zoomCenter(1.25)} title="放大" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">＋</button>
      <button onClick={() => zoomCenter(0.8)} title="缩小" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">－</button>
      <button onClick={resetView} title="重置视图" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-sm leading-none">⟲</button>
      <span className="text-center text-[10px] text-zinc-400 select-none">{Math.round(scale * 100)}%</span>
    </div>
    {/* Map-image scale (DM only): scales the map to fit the grid while tokens
        keep their size — for calibrating hand-drawn maps. */}
    {/* Fog controls (DM): reveal-all (清空遮罩) and cover-all (添加遮罩), text
        buttons per user request. */}
    {role === 'dm' && (
      <div className="absolute bottom-3 left-3 z-20 flex flex-col items-stretch gap-1 bg-zinc-800/90 rounded-lg p-1 shadow-lg shadow-black/40">
        <span className="text-center text-[10px] text-zinc-400 select-none">迷雾</span>
        <button onClick={() => connection.sendOps([{ op: 'revealAllFog' }])}
          className="px-2 py-1 rounded hover:bg-emerald-700/30 text-emerald-400 text-xs">一键清空遮罩</button>
        <button onClick={() => connection.sendOps([{ op: 'coverAllFog' }])}
          className="px-2 py-1 rounded hover:bg-amber-700/30 text-amber-400 text-xs">一键添加遮罩</button>
      </div>
    )}
    {role === 'dm' && scene?.mapImage && (
      <div className="absolute bottom-28 left-3 z-20 flex flex-col items-stretch gap-1 bg-zinc-800/90 rounded-lg p-1 shadow-lg shadow-black/40">
        <span className="text-center text-[10px] text-zinc-400 select-none">地图</span>
        <button onClick={() => adjustMapScale(1.1)} title="地图放大" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">＋</button>
        <button onClick={() => adjustMapScale(0.9)} title="地图缩小" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">－</button>
        <button onClick={() => setMapScale(1)} title="地图重置为 100%" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-sm leading-none">⟲</button>
        <span className="text-center text-[10px] text-zinc-400 select-none">{Math.round(displayedMapScale * 100)}%</span>
      </div>
    )}
  </div>
  );
}
