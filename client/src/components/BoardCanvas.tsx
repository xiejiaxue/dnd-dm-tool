import { Stage, Layer, Rect, Line, Image as KImage, Group } from 'react-konva';
import Konva from 'konva';
import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { useScene, connection, getMySessionId } from '../ws';
import { useImage } from '../useImage';
import { FOG_CELL, fogGridSize } from '../types';
import TokenShape from './TokenShape';
import ZoomControl from './ZoomControl';
import { zoomAroundPoint, wheelZoomFactor } from './board-zoom';
import { useMapScale } from '../hooks/useMapScale';
import type { PendingToken } from '../pending';

// Fog overlay color by role: the DM sees a translucent red veil (they can see
// through it), players see near-opaque dark so unrevealed areas hide the map.
const FOG_COLOR = { dm: 'rgba(186,53,38,0.32)', player: '#141412', spectator: '#141412' } as const;

// Shared ink/accent tokens for the canvas layer (mirror of tailwind.config).
const INK = '#20221e';
const ACCENT = '#ba3526';
const MAP_LOADING = '#E3E1D8';

interface Props {
  tool: string;
  pending: PendingToken | null;
  onClearPending: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Kept for the existing table shell. The board now measures its own content
  // box, so it also reserves space for a visible filing footer.
  queryOpen: boolean;
  // Eraser brush radius in fog cells (0/1/2), used by the DM's erase tool.
  brushSize: number;
}

export default function BoardCanvas({ tool, pending, onClearPending, selectedId, onSelect, brushSize }: Props) {
  const { scene, role } = useScene();
  const mySessionId = getMySessionId();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  // Wheel devices can emit far more events than the display refresh rate.
  // Coalescing them keeps a large Konva layer from rebuilding for every tick.
  const pendingViewRef = useRef<{ scale: number; pos: { x: number; y: number } } | null>(null);
  const viewFrameRef = useRef<number | null>(null);
  const mapZoom = useMapScale({ sceneId: scene?.id, mapImage: scene?.mapImage, value: scene?.mapScale ?? 1, enabled: role === 'dm' });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
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
  const boardRef = useRef<HTMLDivElement>(null);

  // Size the Konva surface from its actual flex item instead of subtracting
  // hard-coded viewport chrome. This keeps the board above the filing footer
  // (and handles panel/viewport changes without making the footer overlap).
  // Re-run once the scene arrives: the loading early-return renders no ref'd
  // root, so the first pass measures nothing.
  const sceneReady = scene != null;
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
  }, [sceneReady]);

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
      if (viewFrameRef.current !== null) cancelAnimationFrame(viewFrameRef.current);
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
  // The grid spans the whole rendered map (mapSize * mapScale), not just the
  // play area, so fog covers the entire board.
  const fogCellAt = useCallback((wx: number, wy: number): number => {
    if (!scene) return -1;
    const { cols, rows } = fogGridSize(scene);
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
    const { cols, rows } = fogGridSize(scene);
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

  const scheduleView = useCallback((nextScale: number, nextPos: { x: number; y: number }) => {
    pendingViewRef.current = { scale: nextScale, pos: nextPos };
    if (viewFrameRef.current !== null) return;
    viewFrameRef.current = requestAnimationFrame(() => {
      const next = pendingViewRef.current;
      pendingViewRef.current = null;
      viewFrameRef.current = null;
      if (!next) return;
      setScale(next.scale);
      setPos(next.pos);
    });
  }, []);

  // Zoom by a factor around a pointer position (container coordinates), keeping
  // the world point under the cursor fixed — the standard "free zoom" behavior.
  const zoomAt = useCallback((pointer: { x: number; y: number }, factor: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const pending = pendingViewRef.current;
    const oldScale = pending?.scale ?? stage.scaleX();
    const oldPos = pending?.pos ?? { x: stage.x(), y: stage.y() };
    const next = zoomAroundPoint(oldScale, oldPos, pointer, oldScale * factor);
    scheduleView(next.scale, next.pos);
  }, [scheduleView]);

  const setViewScale = useCallback((value: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const previous = pendingViewRef.current ?? { scale: stage.scaleX(), pos: { x: stage.x(), y: stage.y() } };
    const next = zoomAroundPoint(previous.scale, previous.pos, { x: stage.width() / 2, y: stage.height() / 2 }, value);
    scheduleView(next.scale, next.pos);
  }, [scheduleView]);

  const resetView = useCallback(() => {
    scheduleView(1, { x: 0, y: 0 });
  }, [scheduleView]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) return;
    zoomAt(pointer, wheelZoomFactor(e.evt.deltaY, e.evt.deltaMode, stageRef.current?.height() ?? 800));
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

  // Name/HP/avatar patches preserve the fog reference. Avoid iterating every
  // fog cell (and recreating thousands of Konva Rects) for those tiny edits.
  const fogOverlay = useMemo(() => {
    if (!scene) return null;
    const fog = scene.fog;
    const { cols, rows } = fogGridSize(scene);
    const color = FOG_COLOR[role];
    const allCovered = !fog || fog.every(x => !x);
    if (allCovered) {
      return <Rect x={0} y={0} width={cols * FOG_CELL} height={rows * FOG_CELL} fill={color} listening={false} />;
    }
    const cells: { key: string; x: number; y: number }[] = [];
    for (let i = 0; i < cols * rows; i++) {
      if (!fog[i]) cells.push({ key: `f${i}`, x: (i % cols) * FOG_CELL, y: Math.floor(i / cols) * FOG_CELL });
    }
    return <Group listening={false}>{cells.map(c => <Rect key={c.key} x={c.x} y={c.y} width={FOG_CELL} height={FOG_CELL} fill={color} />)}</Group>;
  }, [scene?.fog, scene?.mapImage, scene?.mapSize, scene?.mapScale, scene?.playArea, role]);

  if (!scene) return <div className="absolute inset-0 flex items-center justify-center text-faint tracking-label">连接中…</div>;

  const grid = scene.grid;
  const area = scene.playArea;
  const displayedMapScale = mapZoom.value;
  const tokenInteractionKey = `${grid.snap ? 1 : 0}:${grid.size}:${grid.offset[0]}:${grid.offset[1]}`;

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
            width={scene.mapSize[0] * displayedMapScale}
            height={scene.mapSize[1] * displayedMapScale}
            listening={false}
          />
        )}
        {scene.mapImage && !map && <Rect width={area.w} height={area.h} fill={MAP_LOADING} listening={false} />}
        {/* Existing walls: thick dark lines. */}
        {scene.walls.map(w => (
          <Line key={w.id} points={[w.p1[0], w.p1[1], w.p2[0], w.p2[1]]} stroke={INK} strokeWidth={10} lineCap="round" lineJoin="round" listening={false} />
        ))}
        {/* Live wall preview while dragging. */}
        {wallPreview && (
          <Line points={[...wallPreview]} stroke={ACCENT} strokeWidth={3} dash={[8, 8]} lineCap="round" listening={false} />
        )}
        {scene.tokens.map(t => (
          <TokenShape
            key={t.id}
            token={t}
            active={scene.initiative.find(e => e.active && e.tokenId === t.id) != null}
            selected={selectedId === t.id}
            draggable={role === 'dm' && tool !== 'wall' && tool !== 'erase'}
            interactionKey={tokenInteractionKey}
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
            draggable={tool !== 'wall' && tool !== 'erase' && (role === 'dm' || (role === 'player' && p.sessionId === mySessionId))}
            interactionKey={tokenInteractionKey}
            onSelect={() => onSelect(p.id)}
            onDragEnd={(x, y) => {
              const sx = grid.snap ? Math.round((x - grid.offset[0]) / grid.size) * grid.size + grid.offset[0] : x;
              const sy = grid.snap ? Math.round((y - grid.offset[1]) / grid.size) * grid.size + grid.offset[1] : y;
              connection.sendOps([{ op: 'moveToken', tokenId: p.id, x: sx, y: sy }]);
            }}
            onContextMenu={() => onSelect(p.id)}
          />
        ))}
        {/* Cosmetic fog is memoized above so unrelated small patches do not
            rebuild a large Konva node list. */}
        {fogOverlay}
      </Layer>
    </Stage>
    {/* Fog controls (DM): reveal-all (清空遮罩) and cover-all (添加遮罩), text
        buttons per user request. */}
    {role === 'dm' && (
      <div className="campaign-fog-controls" aria-label="迷雾">
        <span className="panel-label text-center select-none py-1">迷雾</span>
        <button onClick={() => connection.sendOps([{ op: 'revealAllFog' }])}
          className="px-2 py-1 text-xs text-muted hover:text-ink hover:bg-well transition-colors duration-150">全部显示</button>
        <button onClick={() => connection.sendOps([{ op: 'coverAllFog' }])}
          className="px-2 py-1 text-xs text-accent hover:bg-well transition-colors duration-150">全部遮蔽</button>
      </div>
    )}
    <div className="campaign-zoom-dock">
      {role === 'dm' && scene.mapImage && !scene.mapImage.startsWith('blob:') && <ZoomControl key={`${scene.id}:${scene.mapImage}`} kind="map" value={displayedMapScale} onChange={mapZoom.preview} onStep={mapZoom.set} onCommit={mapZoom.commit} onCancel={mapZoom.cancel} onReset={() => mapZoom.set(1)} />}
      <ZoomControl kind="view" value={scale} onChange={setViewScale} onStep={setViewScale} onReset={resetView} />
    </div>
  </div>
  );
}
