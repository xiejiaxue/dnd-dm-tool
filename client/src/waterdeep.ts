import catalog from '../../shared/waterdeep/index.json';
import type { IndexEntry } from './types';
export const waterdeepIndex = catalog.map(row => ({ ...row, type: 'monster' as const } satisfies IndexEntry));
export const waterdeepHp = (id: string | null) => {
  const npc = waterdeepIndex.find(n => n.id === id);
  return npc ? { current: npc.hp, max: npc.hp } : undefined;
};
