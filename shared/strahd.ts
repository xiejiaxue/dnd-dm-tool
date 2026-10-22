import cards from './strahd/cards.json';
import catalog from './strahd/index.json';
import type { IndexEntry } from './types';
export const strahdIndex = catalog.map(row => ({ ...row, type: 'monster' as const } satisfies IndexEntry));
const byId = new Map(cards.map(card => [card.id, card]));
export const getStrahdCard = (id: string) => byId.get(id);
export const searchStrahd = (query: string, type = 'all') => {
  const q = query.trim().toLocaleLowerCase();
  return q && (type === 'all' || type === 'monster') ? strahdIndex.filter(n => `${n.nameZh} ${n.source} ${n.chapters.join(' ')}`.toLocaleLowerCase().includes(q)) : [];
};
const xml = (s: string) => s.replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' })[c]!);
export function strahdToken(id: string) {
  const row = strahdIndex.find(n => n.id === id);
  if (!row) return;
  const name = row.nameZh.split('·')[0].slice(0, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${xml(row.nameZh)}"><circle cx="256" cy="256" r="249" fill="#211923" stroke="#a85a65" stroke-width="14"/><circle cx="256" cy="256" r="222" fill="#3a2633" stroke="#d3ba86" stroke-width="2"/><path d="M206 143 235 108 256 63 277 108 306 143 277 132 256 151 235 132Z" fill="#b97983"/><text x="256" y="286" text-anchor="middle" font-family="sans-serif" font-size="${name.length>3?63:78}" font-weight="700" fill="#fff4de">${xml(name)}</text><text x="256" y="354" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#d3ba86">巴洛维亚 · 2014</text><text x="256" y="402" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#fff4de">CR ${xml(row.cr || '—')}</text></svg>`;
}
