import { Stage, Layer, Rect, Line, Image as KImage, Group } from 'react-konva';
import Konva from 'konva';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useScene, connection } from '../ws';
import { useImage } from '../useImage';
import TokenShape from './TokenShape';
import type { PendingToken } from '../pending';

// Layout offsets around the canvas: Toolbar (w-12) + QueryPanel (w-80),
// TopBar (h-11) + InitiativePanel (h-14).
const OFFSET_X = 48 + 320;
const OFFSET_Y = 44 + 56;

function getStageSize() {
  return { width: window.innerWidth - OFFSET_X, height: window.innerHeight - OFFSET_Y };
}

interface Props {
  tool: string;
  pending: PendingToken | null;
  onClearPending: () => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function BoardCanvas({ tool, pending, onClearPending, selectedId, onSelect }: Props) {
  const { scene, role } = useScene();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState(getStageSize);
  // Live preview line while dragging the wall tool: [x1, y1, x2, y2].
  const [wallPreview, setWallPreview] = useState<[number, number, number, number] | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const wallStart = useRef<[number, number] | null>(null);
  const wallEnd = useRef<{ x: number; y: number } | null>(null);

  // Keep the Stage sized to the viewport when the window resizes.
  useEffect(() => {
    const onResize = () => setStageSize(getStageSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Leaving wall mode cancels any in-progress wall line.
  useEffect(() => {
    if (tool !== 'wall') {
      wallStart.current = null;
      wallEnd.current = null;
      setWallPreview(null);
    }
  }, [tool]);

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

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current!;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition()!;
    const mousePointTo = { x: (pointer.x - stage.x()) / oldScale, y: (pointer.y - stage.y()) / oldScale };
    const dir = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = Math.min(4, Math.max(0.2, oldScale * (dir > 0 ? 1.1 : 0.9)));
    setScale(newScale);
    setPos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  }, []);

  // Wall tool: mousedown on empty canvas records the snapped start point.
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'wall' || !scene || e.target !== stageRef.current) return;
    const p = worldPos();
    if (!p) return;
    wallStart.current = [snap(p.x, 0), snap(p.y, 1)];
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], wallStart.current[0], wallStart.current[1]]);
  }, [tool, scene, worldPos, snap]);

  // Wall tool: mousemove updates the live preview line.
  const handleMouseMove = useCallback(() => {
    if (tool !== 'wall' || !wallStart.current) return;
    const p = worldPos();
    if (!p) return;
    wallEnd.current = p;
    setWallPreview([wallStart.current[0], wallStart.current[1], p.x, p.y]);
  }, [tool, worldPos]);

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

  // Add tool: click empty canvas to place the pending token, snapped to grid.
  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    if (tool !== 'add' || !pending || role !== 'dm' || !scene) return;
    if (e.target !== stageRef.current) return;
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
  }, [tool, pending, role, scene, worldPos, snap, onClearPending]);

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
    <Stage
      ref={stageRef}
      width={stageSize.width}
      height={stageSize.height}
      scaleX={scale} scaleY={scale} x={pos.x} y={pos.y}
      onWheel={handleWheel}
      draggable={role === 'dm' && tool !== 'wall'}
      onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={finishWall}
      onClick={handleClick}
      className={tool === 'add' ? 'cursor-crosshair' : tool === 'wall' ? 'cursor-crosshair' : 'cursor-grab'}
    >
      <Layer>
        {map && <KImage image={map} x={0} y={0} listening={false} />}
        {scene.mapImage && !map && <Rect width={area.w} height={area.h} fill="#262932" listening={false} />}
        <Rect x={area.x} y={area.y} width={area.w} height={area.h} stroke="#f59e0b" strokeWidth={2} strokeScaleEnabled={false} dash={[8, 8]} listening={false} />
        <Group listening={false}>
          {vLines.map(l => <Line key={l.key} points={[l.x, 0, l.x, area.h]} stroke={grid.color} strokeWidth={1} />)}
          {hLines.map(l => <Line key={l.key} points={[0, l.y, area.w, l.y]} stroke={grid.color} strokeWidth={1} />)}
        </Group>
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
            draggable={tool !== 'wall'}
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
            draggable={tool !== 'wall'}
            onSelect={() => onSelect(p.id)}
            onDragEnd={(x, y) => {
              const sx = grid.snap ? Math.round((x - grid.offset[0]) / grid.size) * grid.size + grid.offset[0] : x;
              const sy = grid.snap ? Math.round((y - grid.offset[1]) / grid.size) * grid.size + grid.offset[1] : y;
              connection.sendOps([{ op: 'moveToken', tokenId: p.id, x: sx, y: sy }]);
            }}
            onContextMenu={() => onSelect(p.id)}
          />
        ))}
      </Layer>
    </Stage>
  );
}
