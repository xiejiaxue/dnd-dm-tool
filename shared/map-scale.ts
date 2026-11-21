import type { Scene } from './types';

type Pieces = Pick<Scene, 'tokens' | 'players' | 'walls' | 'notes'>;

const round = (value: number) => Math.round(value * 100) / 100;

/**
 * Board positions after the map picture is rescaled by `ratio` (new / old map scale), so tokens,
 * player pieces, walls and map pins stay on the same spot of the picture instead of drifting off it.
 * Sizes are untouched: module maps size tokens from their printed grid, other maps calibrate the
 * picture to fixed-size tokens. Returns the input unchanged when nothing moves.
 */
export function rescalePieces<T extends Pieces>(scene: T, ratio: number): Pieces {
  if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(ratio - 1) < 1e-9) return scene;
  return {
    tokens: scene.tokens.map(token => ({ ...token, x: round(token.x * ratio), y: round(token.y * ratio) })),
    players: scene.players.map(player => ({ ...player, x: round(player.x * ratio), y: round(player.y * ratio) })),
    walls: scene.walls.map(wall => ({
      ...wall,
      p1: [round(wall.p1[0] * ratio), round(wall.p1[1] * ratio)] as [number, number],
      p2: [round(wall.p2[0] * ratio), round(wall.p2[1] * ratio)] as [number, number],
    })),
    ...(scene.notes ? { notes: scene.notes.map(note => ({ ...note, x: round(note.x * ratio), y: round(note.y * ratio) })) } : {}),
  };
}
