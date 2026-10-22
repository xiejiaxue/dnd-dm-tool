import { Group, Circle, Image as KImage, Text, Ring } from 'react-konva';
import { memo, useEffect, useState } from 'react';
import { useImage } from '../useImage';
import type { Token } from '../types';
import { conditionDefinition } from '../features/conditions/model';

interface Props {
  token: Token;
  active: boolean;
  selected: boolean;
  draggable?: boolean;
  /** Includes grid settings so ignored callback identities cannot go stale. */
  interactionKey: string;
  onSelect: (additive: boolean) => void;
  onDragEnd: (x: number, y: number) => void;
  onContextMenu: () => void;
}

function TokenShape({ token, active, selected, draggable = true, onSelect, onDragEnd, onContextMenu }: Props) {
  const img = useImage(token.avatar || null);
  const renderableImage = img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0 ? img : null;
  const [pulse, setPulse] = useState(0);

  // Animate the active-turn gold ring: oscillate pulse 0..4 while active.
  useEffect(() => {
    if (!active) { setPulse(0); return; }
    let raf: number;
    const tick = (t: number) => {
      setPulse(2 + Math.sin(t / 250) * 2); // 0..4 平滑振荡
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return (
    <Group
      x={token.x} y={token.y}
      opacity={token.hidden ? 0.62 : 1}
      draggable={draggable}
      onDragEnd={(e) => onDragEnd(e.target.x(), e.target.y())}
      onClick={(event) => onSelect(Boolean(event.evt.shiftKey || event.evt.metaKey || event.evt.ctrlKey))}
      onTap={() => onSelect(false)}
      onContextMenu={(e) => { e.evt.preventDefault(); onContextMenu(); }}
    >
      {/* 底圆（颜色环 + 选中高亮） */}
      <Circle
        width={token.size} height={token.size}
        fill={token.color || '#333'}
        stroke={selected ? '#f59e0b' : token.hidden ? '#a78bfa' : token.color || '#000'}
        strokeWidth={selected ? 3 : 1.5}
        dash={token.hidden ? [7, 5] : undefined}
      />
      {/* 头像：圆形裁剪（clipFunc 画圆裁出圆形图）。底圆以 (0,0) 为中心，
          故把头像整体平移 -size/2 使其裁剪圆心也落在 (0,0)，与底圆重合。 */}
      {renderableImage && (
        <Group
          x={-token.size / 2}
          y={-token.size / 2}
          clipFunc={(ctx) => {
            ctx.beginPath();
            ctx.arc(token.size / 2, token.size / 2, token.size / 2, 0, Math.PI * 2, false);
            ctx.closePath();
          }}
        >
          <KImage image={renderableImage} width={token.size} height={token.size} perfectDrawEnabled={false} listening={false} />
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
      {/* 怪物编号徽章（右上角） */}
      {(token.kind === 'monster' || token.kind === 'npc') && token.number != null && (() => {
        const r = token.size * 0.17;
        const cx = token.size * 0.78;
        const cy = token.size * 0.22;
        const fs = r * 1.3;
        return (
          <Group x={0} y={0} listening={false}>
            <Circle x={cx} y={cy} radius={r} fill="#0f1115" stroke="#f59e0b" strokeWidth={2} />
            <Text
              text={String(token.number)}
              x={cx - r} y={cy - fs / 2} width={r * 2}
              align="center" fill="#fbbf24" fontStyle="bold"
              fontSize={fs}
            />
          </Group>
        );
      })()}
      {token.hidden && (
        <Text text="仅主持人" x={-token.size / 2} y={-token.size / 2 - 16} width={token.size} align="center"
          fill="#c4b5fd" fontSize={10} fontStyle="bold" listening={false} />
      )}
      {(token.conditions ?? []).slice(0, 4).map((condition, index) => {
        const definition = conditionDefinition(condition.id);
        const radius = Math.max(8, token.size * 0.11);
        const x = -token.size / 2 + radius + index * (radius * 1.8);
        const y = token.size / 2 - radius;
        return (
          <Group key={condition.id} x={x} y={y} listening={false}>
            <Circle radius={radius} fill="#18181b" stroke={definition.tone} strokeWidth={2} />
            <Text text={definition.badge} x={-radius} y={-radius * 0.7} width={radius * 2} align="center"
              fill={definition.tone} fontSize={radius * 1.15} fontStyle="bold" />
            {condition.remainingRounds !== null && (
              <Text text={String(condition.remainingRounds)} x={radius * 0.35} y={-radius * 1.25} width={radius * 1.2}
                align="center" fill="#fafafa" fontSize={Math.max(8, radius * 0.85)} fontStyle="bold" />
            )}
          </Group>
        );
      })}
      <Text text={token.name} x={-token.size / 2} y={token.size / 2 + 2} width={token.size} align="center"
        fill={token.kind === 'monster' ? '#ef4444' : token.kind === 'npc' ? '#38bdf8' : '#22c55e'} fontSize={12} fontStyle="bold" />
    </Group>
  );
}

// Board patches structurally share untouched tokens. Ignoring freshly-created
// callback closures here lets a remote name/HP/map-scale update avoid
// rerendering every other Konva token; interactionKey covers their only
// callback-captured board setting (grid snapping).
export default memo(TokenShape, (previous, next) => (
  previous.token === next.token
  && previous.active === next.active
  && previous.selected === next.selected
  && previous.draggable === next.draggable
  && previous.interactionKey === next.interactionKey
));
