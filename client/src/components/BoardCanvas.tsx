import { Stage, Layer, Rect, Line, Image as KImage, Group } from 'react-konva';
import Konva from 'konva';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useScene, connection, getMySessionId } from '../ws';
import { useImage } from '../useImage';
import { FOG_CELL } from '../types';
import TokenShape from './TokenShape';
import type { PendingToken } from '../pending';

// Layout offsets around the canvas: Toolbar (w-12) + EnemyList (w-52) +
// QueryPanel (w-80 open / w-10 collapsed), TopBar (h-11) + InitiativePanel (h-14).
const QUERY_OPEN = 320;
const QUERY_CLOSED = 40;
const ENEMY_LIST = 208;
const OFFSET_Y = 44 + 56;

// Fog overlay color by role: the DM sees a translucent amber veil (they can see
// through it), players see near-opaque dark so unrevealed areas hide the map.
const FOG_COLOR = { dm: 'rgba(245,158,11,0.35)', player: 'rgba(15,17,21,0.98)' } as const;

function getStageSize(queryOpen: boolean) {
  const offsetX = 48 + ENEMY_LIST + (queryOpen ? QUERY_OPEN : QUERY_CLOSED);
  return { width: window.innerWidth - offsetX, height: window.innerHeight - OFFSET_Y };
}

interface Props {
  tool: string;
  pending: PendingToken | null;
  onClearPending: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  queryOpen: boolean;
  // Eraser brush radius in fog cells (0/1/2), used by the DM's erase tool.
  brushSize: number;
}

export default function BoardCanvas({ tool, pending, onClearPending, selectedId, onSelect, queryOpen, brushSize }: Props) {
  const { scene, role } = useScene();
  const mySessionId = getMySessionId();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState(() => getStageSize(queryOpen));
  // Live preview line while dragging the wall tool: [x1, y1, x2, y2].
  const [wallPreview, setWallPreview] = useState<[number, number, number, number] | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const wallStart = useRef<[number, number] | null>(null);
  const wallEnd = useRef<{ x: number; y: number } | null>(null);
  // Eraser: batch of fog cells to reveal, drained by a throttled timer so rapid
  // drag strokes coalesce into a single setFog op. eraserDown gates reveals to
  // actual drag strokes (mouse pressed), not mere hovering.
  const eraserBatchRef = useRef<number[]>([]);
  const eraserTimer = useRef<number | null>(null);
  const eraserDown = useRef(false);

  // Keep the Stage sized to the viewport when the window resizes or when the
  // query panel toggles between open/collapsed.
  useEffect(() => {
    const onResize = () => setStageSize(getStageSize(queryOpen));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [queryOpen]);

  // Leaving wall mode cancels any in-progress wall line.
  useEffect(() => {
    if (tool !== 'wall') {
      wallStart.current = null;
      wallEnd.current = null;
      setWallPreview(null);
    }
  }, [tool]);

  // Leaving erase mode drops the queued eraser batch, pending send timer, and
  // the press flag.
  useEffect(() => {
    if (tool !== 'erase') {
      if (eraserTimer.current) clearTimeout(eraserTimer.current);
      eraserTimer.current = null;
      eraserBatchRef.current = [];
      eraserDown.current = false;
    }
  }, [tool]);

  // On unmount, make sure no throttled setFog send is left pending.
  useEffect(() => {
    return () => {
      if (eraserTimer.current) clearTimeout(eraserTimer.current);
    };
  }, []);

  const map = useImage(scene?.mapImage ? scene.mapImage : null);

  // Convert a container-space pointer to world coordinates (unaffected by pan/zoom).
  const worldPos = useCallback((): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    return stage.getRelativePointerPosition();
  }, []);

  // Snap a world coordinate onto the grid (axis 0 = x, 1 = y).
  const snap = useCallback((v: number, axis: 0 | 1): number => {
    if (!scene) return v;
    const grid = scene.grid;
    if (!grid.snap) return v;
    const off = grid.offset[axis];
    return Math.round((v - off) / grid.size) * grid.size + off;
  }, [scene]);

  // Map a world point to its fog cell index (0..cols*rows-1), or -1 if outside.
  const fogCellAt = useCallback((wx: number, wy: number): number => {
    if (!scene) return -1;
    const cols = Math.ceil(scene.playArea.w / FOG_CELL);
    const rows = Math.ceil(scene.playArea.h / FOG_CELL);
    const cx = Math.floor(wx / FOG_CELL);
    const cy = Math.floor(wy / FOG_CELL);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return -1;
    return cy * cols + cx;
  }, [scene]);

  // Collect cells under the brush (radius in fog cells) and queue a throttled
  // setFog send. Scenes without a fog array yet are treated as fully obscured
  // (fogLen = full grid), and the server's ensureFog lazily initializes fog on
  // the first send — so the eraser works on old scenes too.
  const revealAt = useCallback((wx: number, wy: number) => {
    const center = fogCellAt(wx, wy);
    if (center < 0 || !scene) return;
    const cols = Math.ceil(scene.playArea.w / FOG_CELL);
    const rows = Math.ceil(scene.playArea.h / FOG_CELL);
    const fogLen = scene.fog?.length ?? cols * rows;
    const centerCol = center % cols;
    const centerRow = Math.floor(center / cols);
    const r = brushSize;
    for (let dr = -r; dr <= r; dr++) {
      for (let dc = -r; dc <= r; dc++) {
        const row = centerRow + dr;
        const col = centerCol + dc;
        // Stay inside the fog grid — skipping out-of-range avoids wrapping a
        // brush stroke around the play-area border into an unrelated row.
        if (row < 0 || row >= rows || col < 0 || col >= cols) continue;
        const idx = row * cols + col;
        if (idx >= 0 && idx < fogLen && !(scene.fog?.[idx])) {
          eraserBatchRef.current.push(idx);
        }
      }
    }
    if (eraserTimer.current == null) {
      eraserTimer.current = window.setTimeout(() => {
        const cells = [...new Set(eraserBatchRef.current)];
        eraserBatchRef.current = [];
        eraserTimer.current = null;
        if (cells.length) connection.sendOps([{ op: 'setFog', cells, revealed: true }]);
      }, 120);
    }
  }, [fogCellAt, scene, brushSize]);

  const MIN_SCALE = 0.1;
  const MAX_SCALE = 8;

  // Zoom by a factor around a pointer position (container coordinates), keeping
  // the world point under the cursor fixed — the standard "free zoom" behavior.
  const zoomAt = useCallback((pointer: { x: number; y: number }, factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const oldScale = stage.scaleX();
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * factor));
    if (newScale === oldScale) return;
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    setScale(newScale);
    setPos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  }, []);

  // Zoom around the visible canvas centre (used by the +/- buttons).
  const zoomCenter = useCallback((factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    zoomAt({ x: stage.width() / 2, y: stage.height() / 2 }, factor);
  }, [zoomAt]);

  const resetView = useCallback(() => {
    setScale(1);
    setPos({ x: 0, y: 0 });
  }, []);

  // Map-image calibration: scale the map (NOT the tokens/grid) so a hand-drawn
  // map's cells line up with the grid. Sent as an op so it persists per scene.
  const adjustMapScale = useCallback((factor: number) => {
    if (!scene) return;
    const cur = scene.mapScale ?? 1;
    const next = Math.min(5, Math.max(0.1, Math.round(cur * factor * 100) / 100));
    if (next !== cur) connection.sendOps([{ op: 'updateMapScale', mapScale: next }]);
  }, [scene]);

  const setMapScale = useCallback((value: number) => {
    if (!scene) return;
    const clamped = Math.min(5, Math.max(0.1, value));
    if (clamped !== (scene.mapScale ?? 1)) connection.sendOps([{ op: 'updateMapScale', mapScale: clamped }]);
  }, [scene]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    const dir = e.evt.deltaY > 0 ? -1 : 1;
    zoomAt(pointer, dir > 0 ? 1.1 : 0.9);
  }, [zoomAt]);

  // Erase tool: mousedown reveals cells under the brush (DM only) and marks the
  // press so mousemove only reveals while actually dragging. Runs BEFORE the
  // wall guard below so it short-circuits for non-wall tools.
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'erase' && role === 'dm') {
      eraserDown.current = true;
      const p = worldPos();
      if (p) revealAt(p.x, p.y);
      return;
    }
    if (tool !== 'wall' || !scene || e.target !== stageRef.current) return;
    const p = worldPos();
    if (!p) return;
    wallStart.current = [snap(p.x, 0), snap(p.y, 1)];
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], wallStart.current[0], wallStart.current[1]]);
  }, [tool, role, scene, worldPos, snap, revealAt]);

  // Erase tool: while pressed, dragging reveals cells as the pointer moves (DM
  // only). Without the eraserDown gate, mere hovering would reveal.
  const handleMouseMove = useCallback(() => {
    if (tool === 'erase' && role === 'dm') {
      if (!eraserDown.current) return;
      const p = worldPos();
      if (p) revealAt(p.x, p.y);
      return;
    }
    if (tool !== 'wall' || !wallStart.current) return;
    const p = worldPos();
    if (!p) return;
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], p.x, p.y]);
  }, [tool, role, worldPos, revealAt]);

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

  // Finalize the wall even if the pointer is released outside the Stage.
  useEffect(() => {
    if (tool !== 'wall') return;
    const onUp = () => finishWallRef.current();
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, [tool]);

  // Release the eraser press even if the pointer is released outside the Stage
  // (mirrors the wall tool's window mouseup pattern).
  useEffect(() => {
    if (tool !== 'erase') return;
    const onUp = () => { eraserDown.current = false; };
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
          size: 100,
          avatar: pending.avatar,
          color: pending.color,
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
  const vLines: { key: string; x: number }[] = [];
  const hLines: { key: string; y: number }[] = [];
  const area = scene.playArea;
  if (grid.size > 0) {
    for (let x = grid.offset[0]; x <= area.w; x += grid.size) vLines.push({ key: `v${x}`, x });
    for (let y = grid.offset[1]; y <= area.h; y += grid.size) hLines.push({ key: `h${y}`, y });
  }

  return (
    <div className="relative h-full w-full">
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
        if (e.target === stageRef.current) setPos({ x: e.target.x(), y: e.target.y() });
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={finishWall}
      onClick={handleClick}
      className={tool === 'add' || tool === 'wall' ? 'cursor-crosshair' : tool === 'zoom' ? 'cursor-zoom-in' : 'cursor-grab'}
    >
      <Layer>
        {map && (
          <KImage
            image={map}
            x={0} y={0}
            width={scene.mapSize[0] * (scene.mapScale ?? 1)}
            height={scene.mapSize[1] * (scene.mapScale ?? 1)}
            listening={false}
          />
        )}
        {scene.mapImage && !map && <Rect width={area.w} height={area.h} fill="#262932" listening={false} />}
        <Rect x={area.x} y={area.y} width={area.w} height={area.h} stroke="#f59e0b" strokeWidth={2} strokeScaleEnabled={false} dash={[8, 8]} listening={false} />
        {(grid.show ?? true) && (
          <Group listening={false}>
            {vLines.map(l => <Line key={l.key} points={[l.x, 0, l.x, area.h]} stroke={grid.color} strokeWidth={1} />)}
            {hLines.map(l => <Line key={l.key} points={[0, l.y, area.w, l.y]} stroke={grid.color} strokeWidth={1} />)}
          </Group>
        )}
        {/* Existing walls: thick dark lines. */}
        {scene.walls.map(w => (
          <Line key={w.id} points={[w.p1[0], w.p1[1], w.p2[0], w.p2[1]]} stroke="#111827" strokeWidth={10} lineCap="round" lineJoin="round" listening={false} />
        ))}
        {/* Live wall preview while dragging. */}
        {wallPreview && (
          <Line points={[...wallPreview]} stroke="#f59e0b" strokeWidth={3} dash={[8, 8]} lineCap="round" listening={false} />
        )}
        {scene.tokens.map(t => (
          <TokenShape
            key={t.id}
            token={t}
            active={scene.initiative.find(e => e.active && e.tokenId === t.id) != null}
            selected={selectedId === t.id}
            draggable={role === 'dm' && tool !== 'wall' && tool !== 'erase'}
            onSelect={() => onSelect(t.id)}
            onDragEnd={(x, y) => {
              const sx = grid.snap ? Math.round((x - grid.offset[0]) / grid.size) * grid.size + grid.offset[0] : x;
              const sy = grid.snap ? Math.round((y - grid.offset[1]) / grid.size) * grid.size + grid.offset[1] : y;
              connection.sendOps([{ op: 'moveToken', tokenId: t.id, x: sx, y: sy }]);
            }}
            onContextMenu={() => onSelect(t.id)}
          />
        ))}
        {scene.players.map(p => (
          <TokenShape
            key={p.id}
            token={p}
            active={scene.initiative.find(e => e.active && e.tokenId === p.id) != null}
            selected={selectedId === p.id}
            draggable={tool !== 'wall' && tool !== 'erase' && (role === 'dm' || p.sessionId === mySessionId)}
            onSelect={() => onSelect(p.id)}
            onDragEnd={(x, y) => {
              const sx = grid.snap ? Math.round((x - grid.offset[0]) / grid.size) * grid.size + grid.offset[0] : x;
              const sy = grid.snap ? Math.round((y - grid.offset[1]) / grid.size) * grid.size + grid.offset[1] : y;
              connection.sendOps([{ op: 'moveToken', tokenId: p.id, x: sx, y: sy }]);
            }}
            onContextMenu={() => onSelect(p.id)}
          />
        ))}
        {/* 战争迷雾：未揭示格子按角色配色渲染（盖住地图与 token）。无 fog 字段
            的旧场景视为全遮挡，即每个格子都渲染为迷雾。 */}
        {(() => {
          const fog = scene.fog;
          const cols = Math.ceil(area.w / FOG_CELL);
          const rows = Math.ceil(area.h / FOG_CELL);
          const cells: { key: string; x: number; y: number }[] = [];
          for (let i = 0; i < cols * rows; i++) {
            if (!fog || !fog[i]) {
              cells.push({ key: `f${i}`, x: (i % cols) * FOG_CELL, y: Math.floor(i / cols) * FOG_CELL });
            }
          }
          const color = FOG_COLOR[role];
          return (
            <Group listening={false}>
              {cells.map(c => <Rect key={c.key} x={c.x} y={c.y} width={FOG_CELL} height={FOG_CELL} fill={color} />)}
            </Group>
          );
        })()}
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
    {role === 'dm' && scene?.mapImage && (
      <div className="absolute bottom-3 left-3 z-20 flex flex-col items-stretch gap-1 bg-zinc-800/90 rounded-lg p-1 shadow-lg shadow-black/40">
        <span className="text-center text-[10px] text-zinc-400 select-none">地图</span>
        <button onClick={() => adjustMapScale(1.1)} title="地图放大" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">＋</button>
        <button onClick={() => adjustMapScale(0.9)} title="地图缩小" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-base leading-none">－</button>
        <button onClick={() => setMapScale(1)} title="地图重置为 100%" className="w-8 h-8 rounded hover:bg-zinc-700 text-zinc-200 text-sm leading-none">⟲</button>
        <span className="text-center text-[10px] text-zinc-400 select-none">{Math.round((scene.mapScale ?? 1) * 100)}%</span>
      </div>
    )}
  </div>
  );
}
