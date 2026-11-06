import BatchInitiative from './BatchInitiative';
import { selectionRect, selectEnemies, visibilityBatches } from './token-selection';
import { waterdeepHp } from '../waterdeep';
import { Stage, Layer, Rect, Shape, Line, Image as KImage, Group, Circle, Text, Label, Tag } from 'react-konva';
import Konva from 'konva';
import { useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo, type ReactNode } from 'react';
import { useScene, connection, getMySessionId, asPing, type BoardPing } from '../ws';
import TokenConditions from './TokenConditions';
import MapNoteCard from './MapNoteCard';
import { MapPin, PingMarker, PING_MS } from './BoardMarkers';
import { RoomCard, RoomList, RoomMarker, useRoomNotes } from './RoomNotes';
import { useImage } from '../useImage';
import { fogGridSize, fogGeometry, resolveFogBasisScale, type Wall } from '../types';
import { fogBoundary, fogCellAtPoint, fogSelectionRectangle, fogRectangles, type FogRectangle } from './fog-geometry';
import { MAX_DM_FOG_STRENGTH, useDmFogStrength } from '../hooks/useDmFogStrength';
import TokenShape from './TokenShape';
import { gridTokenDiameter } from '../../../shared/map-grid';
import ZoomControl from './ZoomControl';
import { zoomAroundPoint, wheelZoomFactor } from './board-zoom';
import { useMapScale } from '../hooks/useMapScale';
import type { PendingToken } from '../pending';
import ConfirmButton from './ConfirmButton';
import { brushCells, coverCellsOps, findWall, fogCellsInRect, measureDistance, removeWallOps, squarePixels, typingTarget } from './board-tools';
import { gridSquare } from '../../../shared/map-grid';

// Players see opaque dark fog that hides the map and anything on it. The DM
// sees covered ground desaturated and darkened (strength set per browser),
// outlined where it meets revealed ground, with tokens drawn on top.
const PLAYER_FOG = '#141412';
const DM_FOG_SHADE = '20,20,18';

// Shared ink/accent tokens for the canvas layer (mirror of tailwind.config).
const INK = '#20221e';
const ACCENT = '#ba3526';
const MAP_LOADING = '#E3E1D8';

type Point = { x: number; y: number };

/** A row of mutually exclusive option buttons in a tool's options bar. */
function Segmented<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string, string?][]; onChange: (value: T) => void }) {
  return <div className="board-tool-segment" role="group" aria-label={label}>
    {options.map(([option, text, title]) => <button key={option} type="button" aria-pressed={value === option} title={title} onClick={() => onChange(option)}>{text}</button>)}
  </div>;
}

/** Fills every covered piece as one path, which avoids anti-aliased seams between neighbours. */
function coverRectangles(rectangles: FogRectangle[]) {
  return (context: Konva.Context, shape: Konva.Shape) => {
    context.beginPath();
    for (const rect of rectangles) context.rect(rect.x, rect.y, rect.width, rect.height);
    context.fillStrokeShape(shape);
  };
}

interface Props {
  tool: string;
  pending: PendingToken | null;
  onClearPending: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  // Kept for the existing table shell. The board now measures its own content
  // box, so it also reserves space for a visible filing footer.
  queryOpen: boolean;
  // Fog brush radius in fog cells (0/1/2), used by the DM's fog tool.
  brushSize: number;
  onBrushSize?: (size: number) => void;
  /** Lets the fog options switch between brush ('erase') and rectangle ('erase-area'). */
  onTool?: (tool: string) => void;
  /** DM only: draw the board as players see it. */
  playerPreview?: boolean;
  /** Opens a campaign journal in the side panel, from a map note. */
  onOpenJournal?: (journalId: string) => void;
  /** The campaign's module, whose maps may carry keyed room descriptions. */
  templateId?: string;
}

export default function BoardCanvas({ tool, pending, onClearPending, selectedId, onSelect, brushSize, onBrushSize, onTool, playerPreview = false, onOpenJournal, templateId }: Props) {
  const { scene, role } = useScene();
  const mySessionId = getMySessionId();
  const [fogStrength, setFogStrength] = useDmFogStrength();
  const dmView = role === 'dm' && !playerPreview;
  // Fog tool: reveal or cover, for both the brush and the rectangle.
  const [fogMode, setFogMode] = useState<'reveal' | 'cover'>('reveal');
  // Fog cell under the brush, for its outline (-1 when the pointer is off the fog).
  const [brushCenter, setBrushCenter] = useState(-1);
  const brushCenterRef = useRef(-1);
  // Wall tool: draw new walls, or click existing ones to delete them.
  const [wallMode, setWallMode] = useState<'draw' | 'delete'>('draw');
  const [hoverWall, setHoverWall] = useState<string | null>(null);
  // Endpoints of the walls this browser drew, newest last, for undo. The room assigns its own wall
  // ids, so a drawn wall is found again by where it is.
  const myWalls = useRef<Pick<Wall, 'p1' | 'p2'>[]>([]);
  // Ruler: local to this viewer. It stays on the board after release until the next measure, Esc or a tool change.
  const [measure, setMeasure] = useState<{ start: Point; end: Point } | null>(null);
  const measureRef = useRef<{ start: Point; end: Point } | null>(null);
  const measuring = useRef(false);
  // Holding Space pans the board with any tool, as in Foundry, Owlbear Rodeo and most canvas editors.
  const [spacePan, setSpacePan] = useState(false);
  const spacePanRef = useRef(false);
  // Pings from everyone at the table, newest last; each removes itself after its animation.
  const [pings, setPings] = useState<Array<BoardPing & { key: number }>>([]);
  const pingKey = useRef(0);
  // DM ping option: also bring every view to the marked point.
  const [pullPing, setPullPing] = useState(false);
  // The map note whose card is open, and whether it opened in the editor.
  const [openNote, setOpenNote] = useState<{ id: string; editing: boolean } | null>(null);
  // Module maps: the DM sees every keyed room, as markers over the printed labels and as a list.
  const roomAreas = useRoomNotes(scene?.id, scene?.mapImage, templateId, role === 'dm');
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [showRooms, setShowRooms] = useState(true);
  const sceneIdRef = useRef(scene?.id);
  sceneIdRef.current = scene?.id;
  useLayoutEffect(() => { setOpenNote(null); setOpenRoom(null); setPings([]); }, [scene?.id]);
  // A map note and a room share the card slot.
  useEffect(() => { if (openNote) setOpenRoom(null); }, [openNote]);
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

  // The imported Strahd, Phandelver and Hoard maps include very large overviews and multi-floor sheets.
  // Fit once on entry; later pan/zoom and panel resizing remain under user control.
  const fittedStrahdScene = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = /-map-(cosr?|lmop|hdqr?)-/.test(scene?.mapImage ?? '') ? `${scene!.id}:${scene!.mapImage}` : null;
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
    measureRef.current = null;
    measuring.current = false;
    setMeasure(null);
  }, []);

  // A stroke belongs to one tool, mode, scene and map. Never publish it elsewhere.
  useLayoutEffect(() => {
    cancelGesture();
    return cancelGesture;
  }, [tool, fogMode, wallMode, scene?.id, scene?.mapImage, scene?.fogBasisScale, mapZoom.value, scene?.mapSize[0], scene?.mapSize[1], scene?.playArea.x, scene?.playArea.y, scene?.playArea.w, scene?.playArea.h, role, cancelGesture]);

  // Removes the newest wall this browser drew that is still on the board.
  const undoWall = useCallback(() => {
    if (!scene || role !== 'dm') return;
    while (myWalls.current.length) {
      const wall = findWall(scene.walls, myWalls.current.pop()!);
      if (wall) { connection.sendOps([{ op: 'removeWall', wallId: wall.id }]); return; }
    }
  }, [scene, role]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { cancelGesture(); setSelectedEnemies([]); return; }
      if (typingTarget(event.target)) return;
      if (event.code === 'Space') {
        // Only for the board and its tool rail, so Space still presses buttons in the side panels.
        const el = event.target as HTMLElement | null;
        if (el && el !== document.body && !el.closest?.('.campaign-toolbar, .campaign-board')) return;
        // Also keeps Space from scrolling the page or re-clicking the focused tool button.
        event.preventDefault();
        if (!spacePanRef.current) { cancelGesture(); spacePanRef.current = true; setSpacePan(true); }
      }
    };
    const endPan = () => { spacePanRef.current = false; setSpacePan(false); };
    const onKeyUp = (event: KeyboardEvent) => { if (event.code === 'Space') endPan(); };
    const onBlur = () => { cancelGesture(); endPan(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('touchcancel', cancelGesture);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
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
  // setFog send. Scenes without a fog array yet are treated as fully obscured,
  // and the server's ensureFog lazily initializes fog on the first send — so
  // the brush works on old scenes too. Covering sends every cell under the
  // brush, since a covered cell may still hold an exact rectangle reveal.
  const revealAt = useCallback((wx: number, wy: number) => {
    if (!scene) return;
    const { cols, rows } = fogGridSize(scene);
    const reveal = fogMode === 'reveal';
    for (const idx of brushCells(cols, rows, fogCellAt(wx, wy), brushSize)) {
      if (!reveal || !scene.fog?.[idx]) eraserBatchRef.current.push(idx);
    }
    if (eraserTimer.current == null) {
      eraserTimer.current = window.setTimeout(() => {
        const cells = [...new Set(eraserBatchRef.current)];
        eraserBatchRef.current = [];
        eraserTimer.current = null;
        if (cells.length) connection.sendOps([{ op: 'setFog', cells, revealed: reveal, basisScale: resolveFogBasisScale(scene) }]);
      }, 120);
    }
  }, [fogCellAt, scene, brushSize, fogMode]);

  // Ruler ends sit on square centres when the scene grid snaps; module maps have no known grid offset.
  const measurePoint = useCallback((): Point | null => {
    const p = worldPos();
    if (!p || !scene || !scene.grid.snap || gridSquare(scene.mapImage, mapZoom.value) != null) return p;
    const { size, offset } = scene.grid;
    return { x: Math.floor((p.x - offset[0]) / size) * size + offset[0] + size / 2, y: Math.floor((p.y - offset[1]) / size) * size + offset[1] + size / 2 };
  }, [worldPos, scene, mapZoom.value]);

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

  // Keep the zoom and move the board so a board point sits in the middle of the view.
  const centerOn = useCallback((x: number, y: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const viewScale = pendingViewRef.current?.scale ?? stage.scaleX();
    scheduleView(viewScale, { x: stage.width() / 2 - x * viewScale, y: stage.height() / 2 - y * viewScale });
  }, [scheduleView]);

  useEffect(() => connection.onMessage((msg) => {
    const ping = asPing(msg);
    if (!ping || ping.sceneId !== sceneIdRef.current) return;
    const key = ++pingKey.current;
    setPings(list => [...list.slice(-11), { ...ping, key }]);
    window.setTimeout(() => setPings(list => list.filter(item => item.key !== key)), PING_MS);
    if (ping.pull) centerOn(ping.x, ping.y);
  }), [centerOn]);

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
    if (spacePanRef.current) return;
    // Alt-click pings with any tool, as in Foundry; Alt+Shift (or the DM's option) also pulls every view.
    const altPing = 'altKey' in e.evt && e.evt.altKey;
    if ((altPing || tool === 'ping') && role !== 'spectator') {
      const p = worldPos();
      const shift = 'shiftKey' in e.evt && e.evt.shiftKey;
      if (p) connection.ping(p.x, p.y, role === 'dm' && (shift || (tool === 'ping' && pullPing)));
      return;
    }
    if (tool === 'measure') {
      const p = measurePoint();
      if (p) { measuring.current = true; measureRef.current = { start: p, end: p }; setMeasure(measureRef.current); }
      return;
    }
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
    if (tool !== 'wall' || wallMode !== 'draw' || !scene || e.target !== stageRef.current) return;
    const p = worldPos();
    if (!p) return;
    wallStart.current = [snap(p.x, 0), snap(p.y, 1)];
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], wallStart.current[0], wallStart.current[1]]);
  }, [tool, wallMode, role, scene, worldPos, measurePoint, snap, revealAt, cancelGesture, onSelect, pullPing]);

  // Erase tool: while pressed, dragging reveals cells as the pointer moves (DM
  // only). Without the eraserDown gate, mere hovering would reveal.
  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if ('touches' in e.evt && e.evt.touches.length !== 1) { cancelGesture(); return; }
    if (spacePanRef.current) return;
    if (tool === 'measure') {
      const p = measurePoint(), current = measureRef.current;
      if (p && current && measuring.current) { measureRef.current = { start: current.start, end: p }; setMeasure(measureRef.current); }
      return;
    }
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
      const p = worldPos();
      if (!p) return;
      const center = fogCellAt(p.x, p.y);
      if (center !== brushCenterRef.current) { brushCenterRef.current = center; setBrushCenter(center); }
      if (eraserDown.current) revealAt(p.x, p.y);
      return;
    }
    if (tool !== 'wall' || !wallStart.current) return;
    const p = worldPos();
    if (!p) return;
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], p.x, p.y]);
  }, [tool, role, scene, mapZoom.value, worldPos, measurePoint, fogCellAt, revealAt, cancelGesture]);

  const finishMeasure = useCallback(() => { measuring.current = false; }, []);
  const hideBrush = useCallback(() => { brushCenterRef.current = -1; setBrushCenter(-1); }, []);

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
    if (!rect) return;
    if (fogMode === 'reveal') connection.sendOps([{op:'revealFogRect',rect}]);
    else coverCellsOps(fogCellsInRect(scene, rect), resolveFogBasisScale(scene)).forEach(batch => connection.sendOps(batch));
  },[tool,role,scene,worldPos,mapZoom.value,fogMode]);
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
      const id = `w${Date.now()}`;
      myWalls.current.push({ p1: start, p2: end });
      connection.sendOps([{ op: 'addWall', wall: { id, p1: start, p2: end } }]);
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

  // Release the eraser press or the ruler even if the pointer is released outside the Stage
  // (mirrors the wall tool's window mouseup pattern).
  useEffect(() => {
    if (tool !== 'erase' && tool !== 'measure') return;
    const onUp = () => { eraserDown.current = false; measuring.current = false; };
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
    if (tool === 'note' && role === 'dm') {
      const p = worldPos();
      if (!p) return;
      const id = `note-${crypto.randomUUID()}`;
      connection.sendOps([{ op: 'addMapNote', note: { id, x: p.x, y: p.y, title: '新笔记', text: '', visible: false } }]);
      setOpenNote({ id, editing: true });
      return;
    }
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
      // A player's token is their presence on the board; removing it is rarer
      // and more disruptive than clearing a monster, so ask first.
      const player = scene.players.find(p => p.id === selectedId)!;
      if (!window.confirm(`从棋盘移除玩家「${player.name}」的棋子？其先攻条目也会一起移除。`)) return;
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

  const fog = useMemo(() => {
    if (!scene) return null;
    const rectangles = fogRectangles(scene);
    return { rectangles, boundary: role === 'dm' ? fogBoundary(rectangles, fogGeometry(scene)) : [] };
  }, [scene?.fog, scene?.fogReveals, scene?.fogBasisScale, scene?.mapImage, scene?.mapSize, scene?.mapScale, scene?.playArea, role]);

  if (!scene) return <div className="absolute inset-0 flex items-center justify-center text-faint tracking-label">连接中…</div>;

  const grid = scene.grid;
  const area = scene.playArea;
  const displayedMapScale = mapZoom.value;
  const fogBounds = fogGeometry(scene, displayedMapScale);
  const fogMask = (children: ReactNode) => <Group name="fog-mask" x={fogBounds.x} y={fogBounds.y} scaleX={fogBounds.scale} scaleY={fogBounds.scale} clipX={0} clipY={0} clipWidth={fogBounds.width} clipHeight={fogBounds.height} listening={false}>{children}</Group>;
  const tokenInteractionKey = `${tool}:${grid.snap ? 1 : 0}:${grid.size}:${grid.offset[0]}:${grid.offset[1]}`;
  // Tools that use the drag themselves: neither the board nor pieces move under them.
  const drawing = tool === 'select-tokens' || tool === 'wall' || tool === 'erase' || tool === 'erase-area' || tool === 'add' || tool === 'measure' || tool === 'ping' || tool === 'note';
  const selectedPiece = scene.tokens.find(t => t.id === selectedId) ?? scene.players.find(p => p.id === selectedId);
  // The DM edits any piece; a player only their own character.
  const editablePiece = selectedPiece && (role === 'dm' || (role === 'player' && selectedPiece.kind === 'player' && (selectedPiece as { sessionId?: string | null }).sessionId === mySessionId)) ? selectedPiece : null;
  const openNoteData = openNote ? scene.notes?.find(note => note.id === openNote.id) : undefined;
  const rooms = dmView ? roomAreas : [];
  const openRoomData = openRoom ? rooms.find(area => area.key === openRoom) : undefined;
  const openRoomCard = (key: string) => { setOpenNote(null); setOpenRoom(current => current === key ? null : key); };
  const deletingWalls = role === 'dm' && tool === 'wall' && wallMode === 'delete' && !spacePan;
  const brushOutline = (() => {
    if (role !== 'dm' || tool !== 'erase' || brushCenter < 0 || spacePan) return null;
    const cells = brushCells(fogBounds.cols, fogBounds.rows, brushCenter, brushSize);
    const cols = cells.map(c => c % fogBounds.cols), rows = cells.map(c => Math.floor(c / fogBounds.cols));
    const x = Math.min(...cols) * fogBounds.cellSize, y = Math.min(...rows) * fogBounds.cellSize;
    return { x, y, width: Math.min(fogBounds.width, (Math.max(...cols) + 1) * fogBounds.cellSize) - x, height: Math.min(fogBounds.height, (Math.max(...rows) + 1) * fogBounds.cellSize) - y };
  })();
  const ruler = measure && (() => {
    const { squares, feet } = measureDistance(measure.start, measure.end, squarePixels(scene, displayedMapScale));
    return { ...measure, text: `${feet} 尺 · ${squares} 格` };
  })();
  const fogTint = fogMode === 'reveal' ? { fill: 'rgba(186,53,38,0.12)', stroke: ACCENT } : { fill: 'rgba(20,20,18,0.28)', stroke: INK };

  return (
    <div ref={boardRef} className="relative h-full min-h-0 w-full overflow-hidden touch-none">
    {role === 'dm' && (tool === 'erase' || tool === 'erase-area') && <div className="board-tool-options" role="toolbar" aria-label="迷雾选项">
      <strong>迷雾</strong>
      <Segmented label="揭开或遮蔽" value={fogMode} onChange={setFogMode} options={[['reveal', '揭开'], ['cover', '遮蔽']]} />
      {onTool && <Segmented label="迷雾形状" value={tool} onChange={onTool} options={[['erase', '笔刷', '按住拖动涂抹'], ['erase-area', '矩形', '拖出矩形，松开生效；Esc 取消']]} />}
      {tool === 'erase' && onBrushSize && <Segmented label="笔刷大小" value={brushSize} onChange={onBrushSize} options={[[0, '小', '1×1 迷雾格'], [1, '中', '3×3 迷雾格'], [2, '大', '5×5 迷雾格']]} />}
      <span className="board-tool-divider" aria-hidden="true" />
      <button type="button" className="btn-xs" onClick={() => connection.sendOps([{ op: 'revealAllFog' }])}>全部显示</button>
      <ConfirmButton className="btn-xs" armedClassName="text-accent" confirmLabel="确认全部遮蔽" title="整张地图重新盖上迷雾" onConfirm={() => connection.sendOps([{ op: 'coverAllFog' }])}>全部遮蔽</ConfirmButton>
      <label className="campaign-fog-strength" title="迷雾在你这里的压暗程度，只保存在本机，玩家始终看到全黑">
        <span>浓度</span>
        <input type="range" min={0} max={MAX_DM_FOG_STRENGTH * 100} step={5} value={Math.round(fogStrength * 100)} disabled={playerPreview}
          onChange={event => setFogStrength(Number(event.target.value) / 100)} aria-label="DM 端迷雾浓度" />
      </label>
    </div>}
    {role === 'dm' && tool === 'wall' && <div className="board-tool-options" role="toolbar" aria-label="画墙选项">
      <strong>画墙</strong>
      <Segmented label="画墙或删墙" value={wallMode} onChange={setWallMode} options={[['draw', '画墙', '拖动画一段墙'], ['delete', '删墙', '点击一段墙删除它']]} />
      <button type="button" className="btn-xs" title="删除你最近画的一段墙" disabled={!myWalls.current.some(drawn => findWall(scene.walls, drawn))} onClick={undoWall}>撤销</button>
      <ConfirmButton className="btn-xs" armedClassName="text-accent" confirmLabel="确认清除全部墙" title="删除这个场景的所有墙" disabled={!scene.walls.length} onConfirm={() => removeWallOps(scene.walls).forEach(batch => connection.sendOps(batch))}>清除全部</ConfirmButton>
      <span className="board-tool-hint">{wallMode === 'delete' ? '点击墙体删除' : `共 ${scene.walls.length} 段 · 空格拖动平移`}</span>
    </div>}
    {tool === 'measure' && <div className="board-tool-options" role="toolbar" aria-label="测距">
      <strong>测距</strong>
      <span className="board-tool-hint">{ruler ? ruler.text : '拖动测量'} · 每格 5 尺，斜走算 1 格 · 只有你看得到 · Esc 清除</span>
    </div>}
    {tool === 'ping' && role !== 'spectator' && <div className="board-tool-options" role="toolbar" aria-label="标记">
      <strong>标记</strong>
      <span className="board-tool-hint">点击地图，所有人都会看到 · 任何工具下按住 Alt 点击也行</span>
      {role === 'dm' && <label className="board-tool-check" title="标记时把所有人的画面移到这里；也可以 Alt+Shift 点击">
        <input type="checkbox" checked={pullPing} onChange={event => setPullPing(event.target.checked)} />同时拉取所有人的视角
      </label>}
    </div>}
    {role === 'dm' && tool === 'note' && <div className="board-tool-options" role="toolbar" aria-label="地图笔记">
      <strong>笔记</strong>
      <span className="board-tool-hint">点击地图放置图钉 · 共 {scene.notes?.length ?? 0} 个 · 虚线白钉只有你看得到 · 用选择工具拖动图钉</span>
    </div>}
    {role === 'dm' && tool === 'select-tokens' && <div className="absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center gap-2 border border-line bg-panel px-3 py-2 shadow-sm" role="group" aria-label="批量Token可见性">
      <span className="text-xs">{selectedEnemies.length ? `已选 ${scene.tokens.filter(t => selectedEnemies.includes(t.id)).length} 个敌人` : '拖动框选敌人 · Esc 取消'}</span>
      <button className="btn-xs" disabled={!scene.tokens.some(t => selectedEnemies.includes(t.id) && t.hidden)} onClick={() => visibilityBatches(scene.tokens, selectedEnemies, false).forEach(batch => connection.sendOps(batch))}>显示选中</button>
      <button className="btn-xs" disabled={!scene.tokens.some(t => selectedEnemies.includes(t.id) && !t.hidden)} onClick={() => visibilityBatches(scene.tokens, selectedEnemies, true).forEach(batch => connection.sendOps(batch))}>隐藏选中</button>
      <button className="btn-xs" title="仅为选中且尚未加入先攻的敌人掷骰" disabled={!scene.tokens.some(t => selectedEnemies.includes(t.id) && !scene.initiative.some(e => e.tokenId === t.id))} onClick={() => setInitiativeSelection([...selectedEnemies])}>选中先攻</button>
      <button className="btn-xs" disabled={!selectedEnemies.length} onClick={() => setSelectedEnemies([])}>取消选择</button>
    </div>}
    {tool === 'select' && editablePiece && <div className="board-token-bar" role="group" aria-label={`${editablePiece.name} 的设置`}>
      <span className="text-xs truncate max-w-40">{editablePiece.name}{role === 'dm' && editablePiece.kind === 'monster' ? ` · ${editablePiece.hidden ? '仅DM可见' : '玩家可见'}` : ''}</span>
      {role === 'dm' && editablePiece.kind === 'monster' && <button className="btn-xs" onClick={() => connection.sendOps([{ op: 'updateToken', tokenId: editablePiece.id, patch: { hidden: !editablePiece.hidden } }])}>
        {editablePiece.hidden ? '显示' : '隐藏'}
      </button>}
      <TokenConditions conditions={editablePiece.conditions} onChange={conditions => connection.sendOps([editablePiece.kind === 'monster'
        ? { op: 'updateToken', tokenId: editablePiece.id, patch: { conditions } }
        : { op: 'updatePlayer', tokenId: editablePiece.id, patch: { conditions } }])} />
    </div>}
    {openRoomData && !openNoteData && <RoomCard key={openRoomData.key} area={openRoomData} onClose={() => setOpenRoom(null)} />}
    {rooms.length > 0 && <RoomList key={scene.id} areas={rooms} openKey={openRoom} showMarkers={showRooms} onShowMarkers={setShowRooms} onOpen={openRoomCard} />}
    {openNote && openNoteData && <MapNoteCard key={`${openNote.id}:${openNote.editing}`} note={openNoteData} canEdit={role === 'dm'} editing={openNote.editing} onClose={() => setOpenNote(null)} onOpenJournal={onOpenJournal} />}
    {role === 'dm' && tool === 'select-tokens' && initiativeSelection && <BatchInitiative enemyIds={initiativeSelection} onClose={() => setInitiativeSelection(null)} />}
    {stageSize.width > 0 && stageSize.height > 0 && <Stage
      ref={stageRef}
      width={stageSize.width}
      height={stageSize.height}
      scaleX={scale} scaleY={scale} x={pos.x} y={pos.y}
      onWheel={handleWheel}
      // The Stage stays non-draggable while drawing (wall), measuring or erasing
      // so that mousemove fires on every pointer move instead of being captured
      // by a drag. Holding Space pans with any tool.
      draggable={spacePan || !drawing}
      onDragEnd={(e) => {
        // Konva bubbles dragend from dragged children (tokens) up to the Stage;
        // only update the pan position when the Stage itself was the drag target.
        if (e.target === stageRef.current) setPos({ x: e.target.x(), y: e.target.y() });
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={() => { finishSelection(); finishArea(); finishWall(); finishMeasure(); }}
      onMouseLeave={hideBrush}
      onTouchStart={handleMouseDown}
      onTouchMove={handleMouseMove}
      onTouchEnd={() => { finishSelection(); finishArea(); finishWall(); finishMeasure(); hideBrush(); }}
      onTouchCancel={cancelGesture}
      onClick={handleClick}
      onTap={handleClick}
      className={spacePan ? 'cursor-grab' : deletingWalls ? 'cursor-pointer' : drawing ? 'cursor-crosshair' : tool === 'zoom' ? 'cursor-zoom-in' : 'cursor-grab'}
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
        {/* The DM's fog sits under walls and tokens so pieces stay readable. */}
        {dmView && fog && fogMask(<>
          <Shape sceneFunc={coverRectangles(fog.rectangles)} fill="#808080" globalCompositeOperation="saturation" listening={false} />
          {fogStrength > 0 && <Shape sceneFunc={coverRectangles(fog.rectangles)} fill={`rgba(${DM_FOG_SHADE},${fogStrength})`} listening={false} />}
          <Shape sceneFunc={(context, shape) => {
            context.beginPath();
            for (const [x1, y1, x2, y2] of fog.boundary) { context.moveTo(x1, y1); context.lineTo(x2, y2); }
            context.strokeShape(shape);
          }} stroke={ACCENT} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
        </>)}
        {/* Existing walls: thick dark lines; clickable only while deleting walls. */}
        {scene.walls.map(w => (
          <Line key={w.id} name="wall" points={[w.p1[0], w.p1[1], w.p2[0], w.p2[1]]} stroke={deletingWalls && hoverWall === w.id ? ACCENT : INK} strokeWidth={10} lineCap="round" lineJoin="round"
            listening={deletingWalls} hitStrokeWidth={24}
            onMouseEnter={() => setHoverWall(w.id)} onMouseLeave={() => setHoverWall(null)}
            onClick={() => { setHoverWall(null); connection.sendOps([{ op: 'removeWall', wallId: w.id }]); }}
            onTap={() => connection.sendOps([{ op: 'removeWall', wallId: w.id }])} />
        ))}
        {/* Live wall preview while dragging. */}
        {wallPreview && (
          <Line points={[...wallPreview]} stroke={ACCENT} strokeWidth={3} dash={[8, 8]} lineCap="round" listening={false} />
        )}
        {scene.tokens.filter(t => dmView || !t.hidden).map(t => (
          <TokenShape
            key={t.id}
            token={t}
            gridDiameter={gridTokenDiameter(scene.mapImage, displayedMapScale, t)}
            showHp={dmView}
            active={scene.initiative.find(e => e.active && e.tokenId === t.id) != null}
            selected={selectedId === t.id || (role === 'dm' && selectedEnemies.includes(t.id))}
            draggable={role === 'dm' && !drawing}
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
        {/* Players' fog covers enemies too. Its geometry is memoized above so
            unrelated small patches do not rebuild it. */}
        {!dmView && fog && fogMask(<Shape sceneFunc={coverRectangles(fog.rectangles)} fill={PLAYER_FOG} listening={false} />)}
      </Layer>
      {/* Player pieces stay above map, walls, enemies and fog for every viewer. */}
      <Layer name="player-tokens">
        {scene.players.map(p => (
          <TokenShape
            key={p.id}
            token={p}
            gridDiameter={gridTokenDiameter(scene.mapImage, displayedMapScale, p)}
            active={scene.initiative.find(e => e.active && e.tokenId === p.id) != null}
            selected={selectedId === p.id}
            draggable={!drawing && (role === 'dm' || (role === 'player' && p.sessionId === mySessionId))}
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
        {showRooms && rooms.flatMap(area => (area.positions ?? []).map(([x, y], index) => <RoomMarker key={`${area.key}:${index}`} area={area}
          x={x * scene.mapSize[0] * displayedMapScale} y={y * scene.mapSize[1] * displayedMapScale} scale={scale}
          active={openRoom === area.key} listening={!drawing && !spacePan} onOpen={() => openRoomCard(area.key)} />))}
        {(scene.notes ?? []).map(note => <MapPin key={note.id} note={note} scale={scale} active={openNote?.id === note.id}
          draggable={role === 'dm' && tool === 'select' && !spacePan}
          onOpen={() => setOpenNote({ id: note.id, editing: false })}
          onMove={(x, y) => connection.sendOps([{ op: 'updateMapNote', noteId: note.id, patch: { x, y } }])} />)}
        {pings.map(ping => <PingMarker key={ping.key} ping={ping} scale={scale} />)}
        {selectionPreview && <Rect name="token-selection" {...selectionPreview} fill="rgba(186,53,38,0.12)" stroke="#ba3526" strokeWidth={1.5/scale} dash={[6/scale,4/scale]} listening={false} />}
        {areaPreview && <Rect name="fog-selection" {...areaPreview} {...fogTint} strokeWidth={1.5/scale} dash={[6/scale,4/scale]} listening={false} />}
        {brushOutline && <Group name="fog-brush" x={fogBounds.x} y={fogBounds.y} scaleX={fogBounds.scale} scaleY={fogBounds.scale} listening={false}>
          <Rect {...brushOutline} {...fogTint} strokeWidth={1.5} strokeScaleEnabled={false} listening={false} />
        </Group>}
        {ruler && <Group name="ruler" listening={false}>
          <Line points={[ruler.start.x, ruler.start.y, ruler.end.x, ruler.end.y]} stroke={ACCENT} strokeWidth={2 / scale} dash={[8 / scale, 5 / scale]} lineCap="round" listening={false} />
          <Circle x={ruler.start.x} y={ruler.start.y} radius={4 / scale} fill={ACCENT} listening={false} />
          <Circle x={ruler.end.x} y={ruler.end.y} radius={4 / scale} fill={ACCENT} listening={false} />
          <Label x={ruler.end.x} y={ruler.end.y} offsetX={-10} offsetY={30} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
            <Tag fill={INK} cornerRadius={2} listening={false} />
            <Text text={ruler.text} fontSize={13} padding={6} fill="#ffffff" listening={false} />
          </Label>
        </Group>}
      </Layer>
    </Stage>}
    <div className="campaign-zoom-dock">
      {role === 'dm' && scene.mapImage && !scene.mapImage.startsWith('blob:') && <ZoomControl key={`${scene.id}:${scene.mapImage}`} kind="map" value={displayedMapScale} onChange={mapZoom.preview} onStep={mapZoom.set} onCommit={mapZoom.commit} onCancel={mapZoom.cancel} onReset={() => mapZoom.set(1)} />}
      <ZoomControl kind="view" value={scale} onChange={setViewScale} onStep={setViewScale} onReset={resetView} />
    </div>
  </div>
  );
}
