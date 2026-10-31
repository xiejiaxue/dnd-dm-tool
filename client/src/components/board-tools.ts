import { fogGeometry, type Op, type Scene, type Wall } from '../types';
import type { FogRectangle } from './fog-geometry';
import { gridSquare } from '../../../shared/map-grid';

export type Role = 'dm' | 'player' | 'spectator';
export type ToolIcon = 'select' | 'view' | 'ruler' | 'place' | 'wall' | 'fog';

export interface BoardTool {
  id: string;
  label: string;
  icon: ToolIcon;
  /** Single-letter shortcut, as in Foundry and Owlbear Rodeo. Placement has none: it starts from the library. */
  key?: string;
  hint: string;
  dmOnly: boolean;
}

export const BOARD_TOOLS: readonly BoardTool[] = [
  { id: 'select', label: '选择', icon: 'select', key: 'V', hint: '选择和移动棋子；拖动空白处平移棋盘', dmOnly: false },
  { id: 'select-tokens', label: '框选', icon: 'view', key: 'B', hint: '拖动框选敌人，批量显示、隐藏或掷先攻', dmOnly: true },
  { id: 'measure', label: '测距', icon: 'ruler', key: 'R', hint: '拖动测量距离，每格 5 尺，斜走也算 1 格；只有你看得到', dmOnly: false },
  { id: 'add', label: '放置', icon: 'place', hint: '把从资料库拿起的怪物放到棋盘上', dmOnly: true },
  { id: 'wall', label: '画墙', icon: 'wall', key: 'W', hint: '拖动画墙；可切换为删墙，或撤销上一段', dmOnly: true },
  { id: 'erase', label: '迷雾', icon: 'fog', key: 'F', hint: '用笔刷或矩形揭开、遮蔽迷雾', dmOnly: true },
];

export function toolsFor(role: Role) {
  return BOARD_TOOLS.filter(tool => role === 'dm' || !tool.dmOnly);
}

/** The fog button covers both fog shapes. */
export function isToolActive(tool: BoardTool, current: string) {
  return current === tool.id || (tool.id === 'erase' && current === 'erase-area');
}

/** Tool chosen by a plain key press, or null. Pressing F again keeps the current fog shape. */
export function toolForKey(key: string, role: Role, current: string): string | null {
  const tool = toolsFor(role).find(t => t.key?.toLowerCase() === key.toLowerCase());
  if (!tool) return null;
  return tool.id === 'erase' && current === 'erase-area' ? 'erase-area' : tool.id;
}

/** True when a key press belongs to a text field rather than to the board. */
export function typingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

/** One 5-ft square in board pixels: the printed grid of a module map, else the scene grid. */
export function squarePixels(scene: Pick<Scene, 'mapImage' | 'grid'>, mapScale: number) {
  return gridSquare(scene.mapImage, mapScale) ?? scene.grid.size;
}

/** 5e distance: diagonals count as one square, so it is the larger of the two axes. */
export function measureDistance(start: { x: number; y: number }, end: { x: number; y: number }, square: number) {
  const squares = square > 0 ? Math.round(Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / square) : 0;
  return { squares, feet: squares * 5 };
}

/** Square-brush footprint around a fog cell, clipped to the grid (never wrapping into the next row). */
export function brushCells(cols: number, rows: number, center: number, radius: number) {
  if (center < 0) return [];
  const col = center % cols, row = Math.floor(center / cols), cells: number[] = [];
  for (let r = Math.max(0, row - radius); r <= Math.min(rows - 1, row + radius); r++)
    for (let c = Math.max(0, col - radius); c <= Math.min(cols - 1, col + radius); c++) cells.push(r * cols + c);
  return cells;
}

/** Every fog cell a fog-local rectangle touches, for covering: covering snaps out to whole cells. */
export function fogCellsInRect(scene: Scene, rect: FogRectangle) {
  const grid = fogGeometry(scene);
  const c0 = Math.max(0, Math.floor(rect.x / grid.cellSize)), r0 = Math.max(0, Math.floor(rect.y / grid.cellSize));
  const c1 = Math.min(grid.cols, Math.ceil((rect.x + rect.width) / grid.cellSize));
  const r1 = Math.min(grid.rows, Math.ceil((rect.y + rect.height) / grid.cellSize));
  const cells: number[] = [];
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) cells.push(r * grid.cols + c);
  return cells;
}

/** Ops in messages the room accepts: at most 20 ops each, at most 2,000 fog cells per op. */
export function coverCellsOps(cells: number[], basisScale: number): Op[][] {
  const ops: Op[] = [];
  for (let i = 0; i < cells.length; i += 2000) ops.push({ op: 'setFog', cells: cells.slice(i, i + 2000), revealed: false, basisScale });
  return chunk(ops, 20);
}

/** The newest wall with these endpoints, in either direction. */
export function findWall(walls: Wall[], { p1, p2 }: Pick<Wall, 'p1' | 'p2'>) {
  const same = (a: [number, number], b: [number, number]) => a[0] === b[0] && a[1] === b[1];
  for (let i = walls.length - 1; i >= 0; i--) {
    const w = walls[i];
    if ((same(w.p1, p1) && same(w.p2, p2)) || (same(w.p1, p2) && same(w.p2, p1))) return w;
  }
  return undefined;
}

export function removeWallOps(walls: Pick<Wall, 'id'>[]): Op[][] {
  return chunk(walls.map(w => ({ op: 'removeWall' as const, wallId: w.id })), 20);
}

function chunk<T>(items: T[], size: number) {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
