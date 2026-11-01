import { Group, Circle, Image as KImage, Text, Ring, Rect } from 'react-konva';
import { memo, useEffect, useState } from 'react';
import { useImage } from '../useImage';
import type { Token } from '../types';
import { conditionInfo } from '../../../shared/conditions';

/** Condition badges shown above a token before the rest collapse into "+N". */
const MAX_BADGES = 5;

// One board diameter for both kinds, including previously saved 48px players.
const TOKEN_SIZE = 100;

interface Props {
  token: Token;
  active: boolean;
  selected: boolean;
  draggable?: boolean;
  showHp?: boolean;
  /** Board diameter from the map's printed grid; null keeps the stored size rule. */
  gridDiameter?: number | null;
  /** Includes grid settings so ignored callback identities cannot go stale. */
  interactionKey: string;
  onSelect: () => void;
  onDragEnd: (x: number, y: number) => void;
  onContextMenu: () => void;
}

function TokenShape({ token, active, selected, draggable = true, showHp = false, gridDiameter = null, onSelect, onDragEnd, onContextMenu }: Props) {
  const tokenDiameter = gridDiameter ?? (token.entryId?.startsWith('COS__') ? Math.max(12, Math.min(500, token.size)) : TOKEN_SIZE);
  const img = useImage(token.avatar || null);
  const [pulse, setPulse] = useState(0);
  const conditions = token.conditions ?? [];
  const badge = Math.max(16, tokenDiameter * 0.22);
  const shownConditions = conditions.slice(0, conditions.length > MAX_BADGES ? MAX_BADGES - 1 : MAX_BADGES);
  const extraConditions = conditions.length - shownConditions.length;
  const badgeCount = shownConditions.length + (extraConditions > 0 ? 1 : 0);

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
      opacity={token.hidden ? 0.7 : 1}
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
      {token.hidden && <Text text="已隐藏 · 仅DM可见" x={-65} y={-tokenDiameter / 2 - 22 - (badgeCount ? badge + 4 : 0)} width={130} align="center" fill="#FFFFFF" fontSize={12} listening={false} shadowColor="#000" shadowBlur={3} />}
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
      {/* 状态徽章：一字标记，倒计时轮数写在右下角 */}
      {badgeCount > 0 && <Group x={-(badgeCount * (badge + 2) - 2) / 2} y={-tokenDiameter / 2 - badge - 4} listening={false}>
        {shownConditions.map((condition, index) => {
          const info = conditionInfo(condition.id);
          if (!info) return null;
          return <Group key={condition.id} x={index * (badge + 2)}>
            <Rect width={badge} height={badge} fill={info.color} stroke="#FFFFFF" strokeWidth={1.5} cornerRadius={2} />
            <Text text={info.badge} width={badge} height={badge} align="center" verticalAlign="middle" fill="#FFFFFF" fontSize={badge * 0.62} fontStyle="bold" />
            {condition.rounds !== undefined && <Text text={String(condition.rounds)} x={badge * 0.55} y={badge * 0.58} width={badge * 0.45} align="right" fill="#FFFFFF" fontSize={badge * 0.38} fontStyle="bold" shadowColor="#000000" shadowBlur={2} shadowOpacity={1} />}
          </Group>;
        })}
        {extraConditions > 0 && <Group x={shownConditions.length * (badge + 2)}>
          <Rect width={badge} height={badge} fill="#20221e" stroke="#FFFFFF" strokeWidth={1.5} cornerRadius={2} />
          <Text text={`+${extraConditions}`} width={badge} height={badge} align="center" verticalAlign="middle" fill="#FFFFFF" fontSize={badge * 0.45} fontStyle="bold" />
        </Group>}
      </Group>}
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
  && previous.gridDiameter === next.gridDiameter
  && previous.interactionKey === next.interactionKey
));
