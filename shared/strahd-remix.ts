import cards from './strahd-remix/cards.json';
import catalog from './strahd-remix/index.json';
import { drawStrahdToken } from './strahd';
import type { IndexEntry } from './types';
/** The 重置版 v2 library: every original Strahd card plus the reconstruction's own, with its chapters. */
export const strahdRemixIndex = catalog.map(row => ({ ...row, type: 'monster' as const } satisfies IndexEntry));
// Only the reconstruction's own cards join the compendium; the original cards are already served by the Strahd module.
const own = strahdRemixIndex.filter(n => n.id.startsWith('COSR__'));
const byId = new Map(cards.map(card => [card.id, card]));
export const getStrahdRemixCard = (id: string) => byId.get(id);
export const searchStrahdRemix = (query: string, type = 'all') => {
  const q = query.trim().toLocaleLowerCase();
  return q && (type === 'all' || type === 'monster') ? own.filter(n => `${n.nameZh} ${n.nameEn} ${n.aliases?.join(' ') ?? ''} ${n.role ?? ''} ${n.source}`.toLocaleLowerCase().includes(q)) : [];
};
export const strahdRemixToken = (id: string) => drawStrahdToken(own.find(n => n.id === id), '巴洛维亚 · 重置版');
