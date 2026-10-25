import cards from './hoard-remix/cards.json';
import catalog from './hoard-remix/index.json';
import { drawHoardToken } from './hoard';
import type { IndexEntry } from './types';
/** The 重置版 library: every original Hoard card plus the reconstruction's own, with its chapters. */
export const hoardRemixIndex = catalog.map(row => ({ ...row, type: 'monster' as const } satisfies IndexEntry));
// Only the reconstruction's own cards join the compendium; the original cards are already served by the Hoard module.
const own = hoardRemixIndex.filter(n => n.id.startsWith('HDQR__'));
const byId = new Map(cards.map(card => [card.id, card]));
export const getHoardRemixCard = (id: string) => byId.get(id);
export const searchHoardRemix = (query: string, type = 'all') => {
  const q = query.trim().toLocaleLowerCase();
  return q && (type === 'all' || type === 'monster') ? own.filter(n => `${n.nameZh} ${n.nameEn} ${n.aliases.join(' ')} ${n.role} ${n.source}`.toLocaleLowerCase().includes(q)) : [];
};
export const hoardRemixToken = (id: string) => drawHoardToken(own.find(n => n.id === id), '龙后宝山 · 重置版');
