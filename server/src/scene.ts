import { Scene, GridConfig, PlayArea } from './types';

let counter = 0;
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

const DEFAULT_GRID: GridConfig = { size: 100, color: '#00000040', offset: [0, 0], snap: true, show: true };
const DEFAULT_PLAY: PlayArea = { x: 0, y: 0, w: 1600, h: 1200 };

export function createScene(name: string): Scene {
  return {
    id: newId('scene'),
    name,
    mapImage: null,
    mapSize: [1600, 1200],
    mapScale: 1,
    grid: { ...DEFAULT_GRID },
    playArea: { ...DEFAULT_PLAY },
    tokens: [],
    players: [],
    walls: [],
    initiative: [],
    favorites: [],
  };
}
