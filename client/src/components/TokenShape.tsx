import { Group, Circle, Image as KImage, Text, Ring } from 'react-konva';
import { memo, useEffect, useState } from 'react';
import { useImage } from '../useImage';
import type { Token } from '../types';

// One board diameter for both kinds, including previously saved 48px players.
const TOKEN_SIZE = 100;

interface Props {
  token: Token;
  active: boolean;
  selected: boolean;
  draggable?: boolean;
  showHp?: boolean;
  /** Includes grid settings so ignored callback identities cannot go stale. */
  interactionKey: string;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onContextMenu: () => void;
}

function TokenShape({ token, active, selected, draggable = true, showHp = false, onSelect, onDragEnd, onContextMenu }: Props) {
  const tokenDiameter = token.entryId?.startsWith('COS__') ? Math.max(12, Math.min(500, token.size)) : TOKEN_SIZE;
  const img = useImage(token.avatar || null);
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
      id={token.id} name="board-token"
      x={token.x} y={token.y}
      opacity={token.hidden ? 0.4 : 1}
      draggable={draggable}
      onDragEnd={(e) => {
        const { x, y } = e.target.position();
        // Konva mutates the node while dragging. Restore the controlled position
        // before publishing, including when snapping yields an unchanged state.
        e.target.position({ x: token.x, y: token.y });
        onDragEnd(x, y);
      }}
      onClick={onSelect}
      onTap={onSelect}
      onContextMenu={(e) => { e.evt.preventDefault(); onContextMenu(); }}
    >
      {token.hidden && <Text text="已隐藏 · 仅DM可见" x={-65} y={-72} width={130} align="center" fill="#FFFFFF" fontSize={12} listening={false} shadowColor="#000" shadowBlur={3} />}
      {/* 底圆（颜色环 + 选中高亮） */}
      <Circle
        width={tokenDiameter} height={tokenDiameter}
        fill={token.color || '#333'}
        stroke={selected ? '#B93424' : token.color || '#000'}
        strokeWidth={selected ? 3 : 1.5}
      />
      {/* 头像：圆形裁剪（clipFunc 画圆裁出圆形图）。底圆以 (0,0) 为中心，
          故把头像整体平移 -size/2 使其裁剪圆心也落在 (0,0)，与底圆重合。 */}
      {img && (
        <Group
          x={-tokenDiameter / 2}
          y={-tokenDiameter / 2}
          clipFunc={(ctx) => {
            ctx.beginPath();
            ctx.arc(tokenDiameter / 2, tokenDiameter / 2, tokenDiameter / 2, 0, Math.PI * 2, false);
            ctx.closePath();
          }}
        >
          <KImage image={img} width={tokenDiameter} height={tokenDiameter} perfectDrawEnabled={false} listening={false} />
        </Group>
      )}
      {/* 当前回合高亮：白色脉冲环（在明暗地图上都可读） */}
      {active && (
        <Ring
          innerRadius={tokenDiameter / 2 - 6}
          outerRadius={tokenDiameter / 2 + 4 + pulse}
          fillEnabled={false}
          stroke="#FFFFFF" strokeWidth={3}
          listening={false}
        />
      )}
      {/* 怪物编号徽章（右上角）：白底墨边、红色数字 */}
      {token.kind === 'monster' && token.number != null && (() => {
        const r = tokenDiameter * 0.17;
        const cx = tokenDiameter * 0.35;
        const cy = -tokenDiameter * 0.35;
        const fs = r * 1.3;
        return (
          <Group x={0} y={0} listening={false}>
            <Circle x={cx} y={cy} radius={r} fill="#FFFFFF" stroke="#111110" strokeWidth={2} />
            <Text
              text={String(token.number)}
              x={cx - r} y={cy - fs / 2} width={r * 2}
              align="center" fill="#B93424" fontStyle="bold"
              fontSize={fs}
            />
          </Group>
        );
      })()}
      <Text text={token.name} x={-tokenDiameter / 2} y={tokenDiameter / 2 + 2} width={tokenDiameter} align="center"
        fill="#FFFFFF" fontSize={12} fontStyle="bold"
        shadowColor="#000000" shadowBlur={2} shadowOpacity={0.75} />
      {showHp && token.hp && <Text
        text={`HP ${token.hp.current}/${token.hp.max}`}
        x={-tokenDiameter / 2} y={tokenDiameter / 2 + 30} width={tokenDiameter}
        align="center" fill={token.hp.current <= 0 ? '#ffb4a9' : '#FFFFFF'}
        fontSize={12} fontStyle="bold" listening={false}
        shadowColor="#000000" shadowBlur={3} shadowOpacity={1}
      />}
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
  && previous.showHp === next.showHp
  && previous.draggable === next.draggable
  && previous.interactionKey === next.interactionKey
));
