import type { Op, Scene, Token } from './types';
/** A marquee scope includes enemies only; omitted scope preserves the full-scene dialog. */
export function initiativeTokens(scene: Scene, enemyIds?: readonly string[]): Token[] {
  if (enemyIds === undefined) return [...scene.tokens, ...scene.players];
  const ids = new Set(enemyIds);
  return scene.tokens.filter(token => ids.has(token.id));
}
export function initiativeFromEntry(entry: any): { bonus: number; source: string } | null {
  if (Number.isInteger(entry?.initiative)) return { bonus: entry.initiative, source: '数据卡先攻' };
  let dex = entry?.dex;
  if (!Number.isFinite(dex)) {
    const rows: string[][] = entry?.campaignCard?.rows ?? [];
    const single = rows.find(r => r[0] === '敏捷');
    const combined = rows.find(r => r[0] === '力量/敏捷/体质');
    const text = single?.[1] ?? combined?.[1]?.split('/')[1];
    dex = text?.match(/^\s*(\d+)/)?.[1];
    dex = dex === undefined ? undefined : Number(dex);
  }
  return Number.isInteger(dex) && dex >= 1 && dex <= 30 ? { bonus: Math.floor((dex - 10) / 2), source: '敏捷调整值' } : null;
}
export function parseInitiativeBonus(text: string): number | null {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= -50 && n <= 50 ? n : null;
}
export function rollD20(): number {
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= 4294967280);
  return value[0] % 20 + 1;
}
export function batchInitiative(scene: Scene, bonuses: Map<string, number>, die = rollD20) {
  const existing = new Set(scene.initiative.map(e => e.tokenId));
  const ops: Op[] = []; const results: string[] = [];
  for (const token of [...scene.tokens, ...scene.players]) {
    const bonus = bonuses.get(token.id);
    if (bonus === undefined || parseInitiativeBonus(String(bonus)) === null || existing.has(token.id)) continue;
    const roll = die();
    const name = tokenLabel(token);
    ops.push({ op: token.kind === 'player' ? 'updatePlayer' : 'updateToken', tokenId: token.id, patch: { initiativeBonus: bonus } });
    ops.push({ op: 'addToInitiative', name, value: roll + bonus, source: 'dm', tokenId: token.id });
    results.push(`${name}：${roll} ${bonus >= 0 ? '+' : '−'} ${Math.abs(bonus)} = ${roll + bonus}`);
  }
  return { ops, results };
}
export const tokenLabel = (t: Token) => `${t.name}${t.number == null ? '' : ` #${t.number}`}`;
