import { Group, Circle, Text, Label, Tag, Ring } from 'react-konva';
import { memo, useEffect, useState } from 'react';
import type { MapNote } from '../types';
import type { BoardPing } from '../ws';

const INK = '#20221e';
const ACCENT = '#ba3526';
const PAPER = '#fcfbf8';
export const PING_MS = 2400;

interface PinProps {
  note: MapNote;
  /** Board zoom: pins keep one screen size, like the ruler label. */
  scale: number;
  active: boolean;
  draggable: boolean;
  onOpen: () => void;
  onMove: (x: number, y: number) => void;
}

/** A map note. Solid pins are visible to players; dashed paper pins are the DM's alone. */
function MapPinShape({ note, scale, active, draggable, onOpen, onMove }: PinProps) {
  const open = (event: { cancelBubble: boolean }) => { event.cancelBubble = true; onOpen(); };
  return <Group name="map-note" x={note.x} y={note.y} draggable={draggable}
    onDragEnd={(event) => {
      const { x, y } = event.target.position();
      event.target.position({ x: note.x, y: note.y });
      if (x !== note.x || y !== note.y) onMove(x, y);
    }}
    onMouseDown={(event) => { event.cancelBubble = true; }}
    onTouchStart={(event) => { event.cancelBubble = true; }}
    onClick={open} onTap={open}>
    <Group scaleX={1 / scale} scaleY={1 / scale}>
      {active && <Ring innerRadius={14} outerRadius={18} fill={ACCENT} listening={false} />}
      <Circle radius={12} fill={note.visible ? INK : PAPER} stroke={INK} strokeWidth={2} dash={note.visible ? undefined : [4, 3]} shadowColor="#000" shadowBlur={4} shadowOpacity={0.35} />
      <Text text={[...note.title][0] ?? '记'} x={-12} y={-12} width={24} height={24} align="center" verticalAlign="middle" fontSize={12} fontStyle="bold" fill={note.visible ? '#FFFFFF' : INK} listening={false} />
      <Label y={16} listening={false}>
        <Tag fill={note.visible ? INK : PAPER} stroke={INK} strokeWidth={note.visible ? 0 : 1} pointerDirection="up" pointerWidth={8} pointerHeight={4} cornerRadius={2} listening={false} />
        <Text text={note.title} fontSize={11} padding={4} fill={note.visible ? '#FFFFFF' : INK} listening={false} />
      </Label>
    </Group>
  </Group>;
}

export const MapPin = memo(MapPinShape, (previous, next) => previous.note === next.note && previous.scale === next.scale && previous.active === next.active && previous.draggable === next.draggable);

/** Expanding rings with the pinger's name, gone after a couple of seconds. */
export function PingMarker({ ping, scale }: { ping: BoardPing; scale: number }) {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, (now - started) / PING_MS);
      setProgress(next);
      if (next < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  const fade = 1 - progress;
  return <Group name="ping" x={ping.x} y={ping.y} scaleX={1 / scale} scaleY={1 / scale} listening={false}>
    {[0, 0.33, 0.66].map(offset => {
      const wave = (progress * 2 + offset) % 1;
      return <Circle key={offset} radius={8 + wave * 46} stroke={ping.color} strokeWidth={3} opacity={fade * (1 - wave)} listening={false} />;
    })}
    <Circle radius={6} fill={ping.color} stroke="#FFFFFF" strokeWidth={2} opacity={Math.min(1, fade * 2)} listening={false} />
    {ping.name && <Label y={-12} opacity={Math.min(1, fade * 2)} listening={false}>
      <Tag fill={ping.color} pointerDirection="down" pointerWidth={8} pointerHeight={5} cornerRadius={2} listening={false} />
      <Text text={ping.name} fontSize={12} padding={5} fill="#FFFFFF" listening={false} />
    </Label>}
  </Group>;
}
