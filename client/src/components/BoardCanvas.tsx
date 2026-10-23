import BatchInitiative from './BatchInitiative';
import { selectionRect, selectEnemies, visibilityBatches } from './token-selection';
import { waterdeepHp } from '../waterdeep';
import { Stage, Layer, Rect, Shape, Line, Image as KImage, Group } from 'react-konva';
import Konva from 'konva';
import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import { useScene, connection, getMySessionId } from '../ws';
import { useImage } from '../useImage';
import { fogGridSize, fogGeometry, resolveFogBasisScale } from '../types';
import { fogCellAtPoint, fogSelectionRectangle, fogRectangles } from './fog-geometry';
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
  const areaRef = useRef<{start:{x:number;y:number};end:{x:number;y:number}} | null>(null);
  const [areaPreview,setAreaPreview] = useState<{x:number;y:number;width:number;height:number}|null>(null);
  const selectionRef = useRef<{start:{x:number;y:number};end:{x:number;y:number}} | null>(null);
  const [selectionPreview, setSelectionPreview] = useState<ReturnType<typeof selectionRect> | null>(null);
  const [selectedEnemies, setSelectedEnemies] = useState<string[]>([]);
  const [initiativeSelection, setInitiativeSelection] = useState<string[] | null>(null);
  useLayoutEffect(() => { setSelectedEnemies([]); setInitiativeSelection(null); }, [scene?.id, role, tool, selectedId]);
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

  // The imported Strahd maps include very large overviews and multi-floor sheets.
  // Fit once on entry; later pan/zoom and panel resizing remain under user control.
  const fittedStrahdScene = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = scene?.mapImage?.includes('-map-cos-') ? `${scene.id}:${scene.mapImage}` : null;
    if (!key) { fittedStrahdScene.current = null; return; }
    if (!scene || fittedStrahdScene.current === key || stageSize.width <= 0 || stageSize.height <= 0) return;
    const width = scene.mapSize[0] * (scene.mapScale ?? 1);
    const height = scene.mapSize[1] * (scene.mapScale ?? 1);
    const fitted = Math.max(0.1, Math.min(1, (stageSize.width - 32) / width, (stageSize.height - 32) / height));
    if (viewFrameRef.current !== null) cancelAnimationFrame(viewFrameRef.current);
    viewFrameRef.current = null; pendingViewRef.current = null;
    setScale(fitted);
    setPos({ x: Math.max(16, (stageSize.width - width * fitted) / 2), y: 16 });
    fittedStrahdScene.current = key;
  }, [scene?.id, scene?.mapImage, stageSize.width, stageSize.height]);

  const cancelGesture = useCallback(() => {
    selectionRef.current = null;
    setSelectionPreview(null);
    areaRef.current = null;
    setAreaPreview(null);
    wallStart.current = null;
    wallEnd.current = null;
    setWallPreview(null);
    if (eraserTimer.current !== null) clearTimeout(eraserTimer.current);
    eraserTimer.current = null;
    eraserBatchRef.current = [];
    eraserDown.current = false;
  }, []);

  // A stroke belongs to one tool, scene and map. Never publish it elsewhere.
  useLayoutEffect(() => {
    cancelGesture();
    return cancelGesture;
  }, [tool, scene?.id, scene?.mapImage, scene?.fogBasisScale, mapZoom.value, scene?.mapSize[0], scene?.mapSize[1], scene?.playArea.x, scene?.playArea.y, scene?.playArea.w, scene?.playArea.h, role, cancelGesture]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { cancelGesture(); setSelectedEnemies([]); } };
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', cancelGesture);
    window.addEventListener('touchcancel', cancelGesture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', cancelGesture);
      window.removeEventListener('touchcancel', cancelGesture);
    };
  }, [cancelGesture]);

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

  const fogCellAt = useCallback((wx: number, wy: number): number => {
    return scene ? fogCellAtPoint(scene, wx, wy, mapZoom.value) : -1;
  }, [scene, mapZoom.value]);

  // Collect cells under the brush (radius in fog cells) and queue a throttled
  // setFog send. Scenes without a fog array yet are treated as fully obscured
  // (fogLen = full grid), and the server's ensureFog lazily initializes fog on
  // the first send — so the eraser works on old scenes too.
  const revealAt = useCallback((wx: number, wy: number) => {
    const center = fogCellAt(wx, wy);
    if (center < 0 || !scene) return;
    const { cols, rows } = fogGridSize(scene);
    const fogLen = cols * rows;
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
        if (cells.length) connection.sendOps([{ op: 'setFog', cells, revealed: true, basisScale: resolveFogBasisScale(scene) }]);
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
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ('touches' in e.evt && e.evt.touches.length !== 1) { cancelGesture(); return; }
    if ('button' in e.evt && e.evt.button !== 0) return;
    if (role !== 'dm') return;
    if (tool === 'select-tokens') {
      const p = worldPos();
      if (p) { selectionRef.current = { start:p, end:p }; setSelectionPreview(selectionRect(p,p)); setSelectedEnemies([]); onSelect(null); }
      return;
    }
    if (tool === 'erase-area') {
      const p = worldPos();
      if (p) { areaRef.current={start:p,end:p};setAreaPreview({x:p.x,y:p.y,width:0,height:0}); }
      return;
    }
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
  }, [tool, role, scene, worldPos, snap, revealAt, cancelGesture, onSelect]);

  // Erase tool: while pressed, dragging reveals cells as the pointer moves (DM
  // only). Without the eraserDown gate, mere hovering would reveal.
  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ('touches' in e.evt && e.evt.touches.length !== 1) { cancelGesture(); return; }
    if (role !== 'dm') return;
    if (tool === 'select-tokens') {
      const p = worldPos(), selection = selectionRef.current;
      if (p && selection) { selection.end = p; setSelectionPreview(selectionRect(selection.start,p)); }
      return;
    }
    if (tool === 'erase-area') {
      const p=worldPos(), area=areaRef.current;
      if (p && area && scene) {
        area.end=p;
        const rect=fogSelectionRectangle(scene,area.start,p,mapZoom.value), grid=fogGeometry(scene,mapZoom.value);
        setAreaPreview(rect ? {x:grid.x+rect.x*grid.scale,y:grid.y+rect.y*grid.scale,width:rect.width*grid.scale,height:rect.height*grid.scale} : null);
      }
      return;
    }
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
  }, [tool, role, scene, mapZoom.value, worldPos, revealAt, cancelGesture]);

  const finishSelection = useCallback(() => {
    const selection = selectionRef.current;
    selectionRef.current = null;
    setSelectionPreview(null);
    if (!selection || role !== 'dm' || tool !== 'select-tokens' || !scene) return;
    setSelectedEnemies(selectEnemies(scene.tokens, selection.start, worldPos() ?? selection.end));
  }, [role, tool, scene, worldPos]);
  const finishSelectionRef = useRef(finishSelection);
  finishSelectionRef.current = finishSelection;
  useEffect(() => {
    if (tool !== 'select-tokens') return;
    const finish = (event: MouseEvent | TouchEvent) => {
      if (!selectionRef.current) return;
      stageRef.current?.setPointersPositions(event);
      finishSelectionRef.current();
    };
    window.addEventListener('mouseup', finish);
    window.addEventListener('touchend', finish);
    return () => { window.removeEventListener('mouseup', finish); window.removeEventListener('touchend', finish); };
  }, [tool]);

  const finishArea = useCallback(() => {
    const area=areaRef.current;
    areaRef.current=null;setAreaPreview(null);
    if (!area || tool !== 'erase-area' || role !== 'dm' || !scene) return;
    const rect=fogSelectionRectangle(scene,area.start,worldPos()??area.end,mapZoom.value);
    if (rect) connection.sendOps([{op:'revealFogRect',rect}]);
  },[tool,role,scene,worldPos,mapZoom.value]);
  const finishAreaRef=useRef(finishArea);finishAreaRef.current=finishArea;
  useEffect(()=>{
    if(tool !== 'erase-area') return;
    const onUp=(event: MouseEvent | TouchEvent)=>{stageRef.current?.setPointersPositions(event);finishAreaRef.current();};
    window.addEventListener('mouseup',onUp);window.addEventListener('touchend',onUp);
    return()=>{window.removeEventListener('mouseup',onUp);window.removeEventListener('touchend',onUp);};
  },[tool]);

  const finishWall = useCallback(() => {
    if (tool !== 'wall' || role !== 'dm' || !wallStart.current || !scene) return;
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
  }, [tool, role, scene, snap]);

  const finishWallRef = useRef(finishWall);
  finishWallRef.current = finishWall;

  // Finalize the wall even if the pointer is released outside the Stage.
  useEffect(() => {
    if (tool !== 'wall') return;
    const onUp = () => finishWallRef.current();
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [tool]);

  // Release the eraser press even if the pointer is released outside the Stage
  // (mirrors the wall tool's window mouseup pattern).
  useEffect(() => {
    if (tool !== 'erase') return;
    const onUp = () => { eraserDown.current = false; };
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchend', onUp);
    };
  }, [tool]);

  // Empty-canvas click: zoom tool zooms, add tool places the pending token,
  // select tool deselects.
  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool === 'select-tokens') return;
    if (!scene || (e.target !== stageRef.current && tool !== 'add')) return;
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
          hidden: true,
          name: pending.name,
          entryId: pending.entryId,
          x: sx,
          y: sy,
          size: 100,
          avatar: pending.avatar,
          color: pending.color,
          hp: waterdeepHp(pending.entryId),
        },
      }]);
      onClearPending();
      onSelect(null);
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

  const fogOverlay = useMemo(() => {
    if (!scene) return null;
    const rectangles = fogRectangles(scene);
    // One fill avoids anti-aliased seams between adjacent covered pieces.
    return <Shape fill={FOG_COLOR[role]} listening={false} sceneFunc={(context, shape) => {
      context.beginPath();
      for (const rect of rectangles) context.rect(rect.x, rect.y, rect.width, rect.height);
      context.fillStrokeShape(shape);
    }} />;
  }, [scene?.fog, scene?.fogReveals, scene?.fogBasisScale, scene?.mapImage, scene?.mapSize, scene?.mapScale, scene?.playArea, role]);

  if (!scene) return <div className="absolute inset-0 flex items-center justify-center text-faint tracking-label">连接中…</div>;

  const grid = scene.grid;
  const displayedMapScale = mapZoom.value;
  const fogBounds = fogGeometry(scene, displayedMapScale);
  const tokenInteractionKey = `${tool}:${grid.snap ? 1 : 0}:${grid.size}:${grid.offset[0]}:${grid.offset[1]}`;

  return (
    <div ref={boardRef} className="relative h-full min-h-0 w-full overflow-hidden touch-none">
    {role === 'dm' && tool === 'select-tokens' && <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center gap-2 border border-line bg-panel px-3 py-2 shadow-sm" role="group" aria-label="批量Token可见性">
      <span className="text-xs">{selectedEnemies.length ? `已选 ${scene.tokens.filter(t => selectedEnemies.includes(t.id)).length} 个敌人` : '拖动框选敌人 · Esc 取消'}</span>
      <button className="btn-xs" disabled={!scene.tokens.some(t => selectedEnemies.includes(t.id) && t.hidden)} onClick={() => visibilityBatches(scene.tokens, selectedEnemies, false).forEach(batch => connection.sendOps(batch))}>显示选中</button>
      <button className="btn-xs" disabled={!scene.tokens.some(t => selectedEnemies.includes(t.id) && !t.hidden)} onClick={() => visibilityBatches(scene.tokens, selectedEnemies, true).forEach(batch => connection.sendOps(batch))}>隐藏选中</button>
      <button className="btn-xs" title="仅为选中且尚未加入先攻的敌人掷骰" disabled={!scene.tokens.some(t => selectedEnemies.includes(t.id) && !scene.initiative.some(e => e.tokenId === t.id))} onClick={() => setInitiativeSelection([...selectedEnemies])}>选中先攻</button>
      <button className="btn-xs" disabled={!selectedEnemies.length} onClick={() => setSelectedEnemies([])}>取消选择</button>
    </div>}
    {role === 'dm' && tool !== 'select-tokens' && scene.tokens.find(t => t.id === selectedId) && (() => {
      const token = scene.tokens.find(t => t.id === selectedId)!;
      return <div className="absolute top-3 left-3 z-10 flex items-center gap-2 border border-line bg-panel px-3 py-2 shadow-sm">
        <span className="text-xs truncate max-w-40">{token.name} · {token.hidden ? '仅DM可见' : '玩家可见'}</span>
        <button className="btn-xs" onClick={() => connection.sendOps([{ op: 'updateToken', tokenId: token.id, patch: { hidden: !token.hidden } }])}>
          {token.hidden ? '显示' : '隐藏'}
        </button>
      </div>;
    })()}
    {role === 'dm' && tool === 'select-tokens' && initiativeSelection && <BatchInitiative enemyIds={initiativeSelection} onClose={() => setInitiativeSelection(null)} />}
    {stageSize.width > 0 && stageSize.height > 0 && <Stage
      ref={stageRef}
      width={stageSize.width}
      height={stageSize.height}
      scaleX={scale} scaleY={scale} x={pos.x} y={pos.y}
      onWheel={handleWheel}
      // The Stage stays non-draggable while drawing (wall) or erasing so that
      // mousemove fires on every pointer move instead of being captured by a
      // drag — same pattern the wall tool uses for its live preview.
      draggable={tool !== 'select-tokens' && tool !== 'wall' && tool !== 'erase' && tool !== 'erase-area' && tool !== 'add'}
      onDragEnd={(e) => {
        // Konva bubbles dragend from dragged children (tokens) up to the Stage;
        // only update the pan position when the Stage itself was the drag target.
        if (e.target === stageRef.current) setPos({ x: e.target.x(), y: e.target.y() });
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => { finishSelection(); finishArea(); finishWall(); }}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={() => { finishSelection(); finishArea(); finishWall(); }}
      onTouchCancel={cancelGesture}
      onClick={handleClick}
      onTap={handleClick}
      className={tool === 'select-tokens' || tool === 'add' || tool === 'wall' || tool === 'erase-area' ? 'cursor-crosshair' : tool === 'zoom' ? 'cursor-zoom-in' : 'cursor-grab'}
    >
      <Layer>
        {map && (
          <Group name="map-image" scaleX={displayedMapScale} scaleY={displayedMapScale} listening={false}><KImage
            image={map}
            x={0} y={0}
            width={scene.mapSize[0]}
            height={scene.mapSize[1]}
            listening={false}
          /></Group>
        )}
        {scene.mapImage && !map && <Rect width={scene.mapSize[0] * displayedMapScale} height={scene.mapSize[1] * displayedMapScale} fill={MAP_LOADING} listening={false} />}
        {/* Existing walls: thick dark lines. */}
        {scene.walls.map(w => (
          <Line key={w.id} points={[w.p1[0], w.p1[1], w.p2[0], w.p2[1]]} stroke={INK} strokeWidth={10} lineCap="round" lineJoin="round" listening={false} />
        ))}
        {/* Live wall preview while dragging. */}
        {wallPreview && (
          <Line points={[...wallPreview]} stroke={ACCENT} strokeWidth={3} dash={[8, 8]} lineCap="round" listening={false} />
        )}
        {scene.tokens.filter(t => role === 'dm' || !t.hidden).map(t => (
          <TokenShape
            key={t.id}
            token={t}
            showHp={role === 'dm'}
            active={scene.initiative.find(e => e.active && e.tokenId === t.id) != null}
            selected={selectedId === t.id || (role === 'dm' && selectedEnemies.includes(t.id))}
            draggable={role === 'dm' && tool !== 'select-tokens' && tool !== 'wall' && tool !== 'erase' && tool !== 'erase-area' && tool !== 'add'}
            interactionKey={tokenInteractionKey}
            onSelect={() => { if (tool !== 'select-tokens') onSelect(t.id); }}
            onDragEnd={(x, y) => {
              const sx = grid.snap ? Math.round((x - grid.offset[0]) / grid.size) * grid.size + grid.offset[0] : x;
              const sy = grid.snap ? Math.round((y - grid.offset[1]) / grid.size) * grid.size + grid.offset[1] : y;
              connection.sendOps([{ op: 'moveToken', tokenId: t.id, x: sx, y: sy }]);
            }}
            onContextMenu={() => onSelect(t.id)}
          />
        ))}
        {/* Cosmetic fog is memoized above so unrelated small patches do not
            rebuild a large Konva node list. */}
        <Group name="fog-mask" x={fogBounds.x} y={fogBounds.y} scaleX={fogBounds.scale} scaleY={fogBounds.scale} clipX={0} clipY={0} clipWidth={fogBounds.width} clipHeight={fogBounds.height} listening={false}>{fogOverlay}</Group>
      </Layer>
      {/* Player pieces stay above map, walls, enemies and fog for every viewer. */}
      <Layer name="player-tokens">
        {scene.players.map(p => (
          <TokenShape
            key={p.id}
            token={p}
            active={scene.initiative.find(e => e.active && e.tokenId === p.id) != null}
            selected={selectedId === p.id}
            draggable={tool !== 'select-tokens' && tool !== 'wall' && tool !== 'erase' && tool !== 'erase-area' && tool !== 'add' && (role === 'dm' || (role === 'player' && p.sessionId === mySessionId))}
            interactionKey={tokenInteractionKey}
            onSelect={() => { if (tool !== 'select-tokens') onSelect(p.id); }}
            onDragEnd={(x, y) => {
              const sx = grid.snap ? Math.round((x - grid.offset[0]) / grid.size) * grid.size + grid.offset[0] : x;
              const sy = grid.snap ? Math.round((y - grid.offset[1]) / grid.size) * grid.size + grid.offset[1] : y;
              connection.sendOps([{ op: 'moveToken', tokenId: p.id, x: sx, y: sy }]);
            }}
            onContextMenu={() => onSelect(p.id)}
          />
        ))}
        {selectionPreview && <Rect name="token-selection" {...selectionPreview} fill="rgba(186,53,38,0.12)" stroke="#ba3526" strokeWidth={1.5/scale} dash={[6/scale,4/scale]} listening={false} />}
        {areaPreview && <Rect name="fog-selection" {...areaPreview} fill="rgba(186,53,38,0.12)" stroke="#ba3526" strokeWidth={1.5/scale} dash={[6/scale,4/scale]} listening={false} />}
      </Layer>
    </Stage>}
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
