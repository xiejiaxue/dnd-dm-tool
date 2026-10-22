import cards from './waterdeep/cards.json';
import catalog from './waterdeep/index.json';
import type { IndexEntry } from './types';

export const waterdeepIndex: (IndexEntry & { faction: string; category: string; location: string; hp: number; combat: boolean; template: string })[] = catalog.map(row => ({ ...row, type: 'monster' as const }));
const cardsById = new Map(cards.map(card => [card.id, card]));
export const getWaterdeepCard = (id: string) => cardsById.get(id);
export function searchWaterdeep(query: string, type = 'all') {
  if (type !== 'all' && type !== 'monster') return [];
  const q = query.trim().toLocaleLowerCase();
  if (!q) return [];
  return waterdeepIndex.filter(row => `${row.nameZh} ${row.nameEn} ${row.source} ${row.faction} ${row.location}`.toLocaleLowerCase().includes(q));
}
const escapeXml = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
export function waterdeepToken(id: string): string | undefined {
  const npc = waterdeepIndex.find(row => row.id === id);
  if (!npc) return undefined;
  let hue = 0;
  for (const c of npc.faction) hue = (hue * 31 + c.charCodeAt(0)) % 360;
  const short = npc.nameZh.split('·')[0].slice(0, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${escapeXml(npc.nameZh)}"><circle cx="256" cy="256" r="250" fill="#171c26" stroke="hsl(${hue},55%,60%)" stroke-width="12"/><circle cx="256" cy="256" r="221" fill="hsl(${hue},35%,22%)" stroke="#d6bb83" stroke-width="2"/><path d="M256 74 300 118 256 162 212 118Z" fill="none" stroke="#d6bb83" stroke-width="4"/><text x="256" y="288" text-anchor="middle" fill="#fff4dc" font-family="sans-serif" font-size="${short.length > 3 ? 65 : 80}" font-weight="700">${escapeXml(short)}</text><text x="256" y="357" text-anchor="middle" fill="#d6bb83" font-family="sans-serif" font-size="23">${escapeXml(npc.faction.slice(0, 15))}</text><text x="256" y="403" text-anchor="middle" fill="#fff4dc" font-family="sans-serif" font-size="22">CR ${escapeXml(npc.cr ?? '—')}</text></svg>`;
}
