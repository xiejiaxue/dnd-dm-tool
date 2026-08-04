import { Group, Circle, Image as KImage, Text, Ring } from 'react-konva';
import { useState } from 'react';
import { useImage } from '../useImage';
import type { Token } from '../types';

interface Props {
  token: Token;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onContextMenu: () => void;
}

export default function TokenShape({ token, active, selected, onSelect, onDragEnd, onContextMenu }: Props) {
  const img = useImage(token.avatar || null);
  const [pulse, setPulse] = useState(0);

  return (
    <Group
      x={token.x} y={token.y}
      draggable
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
      onClick={onSelect}
      onTap={onSelect}
      onContextMenu={(e) => { e.evt.preventDefault(); onContextMenu(); }}
    >
      {/* 底圆（颜色环 + 选中高亮） */}
      <Circle
        width={token.size} height={token.size}
        fill={token.color || '#333'}
        stroke={selected ? '#f59e0b' : token.color || '#000'}
        strokeWidth={selected ? 3 : 1.5}
      />
      {/* 头像：圆形裁剪（clipFunc 画圆裁出圆形图） */}
      {img && (
        <Group
          clipFunc={(ctx) => {
            ctx.beginPath();
            ctx.arc(token.size / 2, token.size / 2, token.size / 2, 0, Math.PI * 2, false);
            ctx.closePath();
          }}
        >
          <KImage image={img} width={token.size} height={token.size} perfectDrawEnabled={false} listening={false} />
        </Group>
      )}
      {/* 当前回合高亮：金色脉冲环 */}
      {active && (
        <Ring
          innerRadius={token.size / 2 - 6}
          outerRadius={token.size / 2 + 4 + pulse}
          fillEnabled={false}
          stroke="#fbbf24" strokeWidth={3}
          listening={false}
        />
      )}
      <Text text={token.name} y={token.size / 2 + 2} width={token.size} align="center" fill="#fff" fontSize={12} fontStyle="bold" />
    </Group>
  );
}
