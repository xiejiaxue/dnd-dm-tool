import type { PlayArea } from './types';

interface TokenPlacementScene {
  playArea: PlayArea;
  tokens: readonly unknown[];
}

const SPAWN_INSET = 100;
const SPAWN_GAP = 110;
const SPAWN_COLUMNS = 5;

/**
 * Tile one-click monster additions inside a predictable top-left spawn zone.
 * A large map is initially shown from that corner, so using the whole map's
 * centre can make a successful addition appear to have done nothing.
 */
export function nextTokenSpawn(scene: TokenPlacementScene): { x: number; y: number } {
  const area = scene.playArea;
  const index = scene.tokens.length;
  const insetX = Math.min(SPAWN_INSET, area.w / 2);
  const insetY = Math.min(SPAWN_INSET, area.h / 2);
  const minX = area.x + insetX;
  const minY = area.y + insetY;
  const maxX = area.x + area.w - insetX;
  const maxY = area.y + area.h - insetY;

  return {
    x: Math.min(maxX, minX + (index % SPAWN_COLUMNS) * SPAWN_GAP),
    y: Math.min(maxY, minY + Math.floor(index / SPAWN_COLUMNS) * SPAWN_GAP),
  };
}
