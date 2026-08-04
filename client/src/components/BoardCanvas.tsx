import { Stage, Layer, Rect, Line, Image as KImage, Group } from 'react-konva';
import Konva from 'konva';
import { useRef, useState, useCallback, useEffect } from 'react';
import { useScene } from '../ws';
import { useImage } from '../useImage';

// Layout offsets around the canvas: Toolbar (w-12) + QueryPanel (w-80),
// TopBar (h-11) + InitiativePanel (h-14).
const OFFSET_X = 48 + 320;
const OFFSET_Y = 44 + 56;

function getStageSize() {
  return { width: window.innerWidth - OFFSET_X, height: window.innerHeight - OFFSET_Y };
}

export default function BoardCanvas() {
  const { scene, role } = useScene();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [stageSize, setStageSize] = useState(getStageSize);
  const stageRef = useRef<Konva.Stage>(null);

  // Keep the Stage sized to the viewport when the window resizes.
  useEffect(() => {
    const onResize = () => setStageSize(getStageSize());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const map = useImage(scene?.mapImage ? scene.mapImage : null);

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
      draggable={role === 'dm'}
      onDragEnd={(e) => setPos({ x: e.target.x(), y: e.target.y() })}
      className="cursor-grab"
    >
      <Layer>
        {map && <KImage image={map} x={0} y={0} />}
        {scene.mapImage && !map && <Rect width={area.w} height={area.h} fill="#262932" />}
        <Rect x={area.x} y={area.y} width={area.w} height={area.h} stroke="#f59e0b" strokeWidth={2} strokeScaleEnabled={false} dash={[8, 8]} />
        <Group>
          {vLines.map(l => <Line key={l.key} points={[l.x, 0, l.x, area.h]} stroke={grid.color} strokeWidth={1} />)}
          {hLines.map(l => <Line key={l.key} points={[0, l.y, area.w, l.y]} stroke={grid.color} strokeWidth={1} />)}
        </Group>
      </Layer>
    </Stage>
  );
}
