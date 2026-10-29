import cards from './phandelver/cards.json';
import catalog from './phandelver/index.json';
import type { IndexEntry } from './types';
export const phandelverIndex = catalog.map(row => ({ ...row, type: 'monster' as const } satisfies IndexEntry));
const byId = new Map(cards.map(card => [card.id, card]));
export const getPhandelverCard = (id: string) => byId.get(id);
export const searchPhandelver = (query: string, type = 'all') => {
  const q = query.trim().toLocaleLowerCase();
  return q && (type === 'all' || type === 'monster') ? phandelverIndex.filter(n => `${n.nameZh} ${n.nameEn} ${n.aliases.join(' ')} ${n.role} ${n.source}`.toLocaleLowerCase().includes(q)) : [];
};
const xml = (s: string) => s.replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' })[c]!);
export function phandelverToken(id: string) {
  const row = phandelverIndex.find(n => n.id === id);
  if (!row) return;
  const name = row.nameZh.split(/[·（]/)[0].slice(0, 4);
  const footer = row.cr ? `CR ${row.cr}` : '人物';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="${xml(row.nameZh)}"><circle cx="256" cy="256" r="249" fill="#17261d" stroke="#4f8a5b" stroke-width="14"/><circle cx="256" cy="256" r="222" fill="#22382a" stroke="#c9a85a" stroke-width="2"/><path d="M196 150 256 70 316 150 286 150 256 112 226 150Z" fill="#c9a85a"/><text x="256" y="286" text-anchor="middle" font-family="sans-serif" font-size="${name.length>3?63:78}" font-weight="700" fill="#f4ecd6">${xml(name)}</text><text x="256" y="354" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#c9a85a">凡达林 · 2014</text><text x="256" y="402" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#f4ecd6">${xml(footer)}</text></svg>`;
}
