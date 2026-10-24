import type { InitiativeEntry, Scene } from './types';

// The Durable Object and the browser's optimistic reducer both apply these, so
// a predicted turn change always matches the authoritative one.

type TurnScene = Pick<Scene, 'initiative' | 'round' | 'tokens'>;
export type TurnState = Pick<Scene, 'initiative' | 'round'>;

/** A monster token at 0 HP or below: its turn is skipped while anyone else can act. */
export function isDefeated(scene: Pick<Scene, 'tokens'>, entry: InitiativeEntry): boolean {
  if (!entry.tokenId) return false;
  const token = scene.tokens.find((candidate) => candidate.id === entry.tokenId);
  return Boolean(token && token.kind === 'monster' && token.hp && token.hp.current <= 0);
}

/**
 * Move the active marker one turn forward (1) or back (-1), skipping defeated
 * monsters. Wrapping past the end starts the next round; stepping back past
 * the top returns to the previous one. The first advance starts round 1.
 */
export function stepTurn(scene: TurnScene, direction: 1 | -1): TurnState {
  const entries = scene.initiative;
  if (entries.length === 0) return { initiative: entries, round: undefined };
  const activeIndex = entries.findIndex((entry) => entry.active);
  if (activeIndex < 0 && direction < 0) return { initiative: entries, round: scene.round };
  const skip = entries.some((entry) => !isDefeated(scene, entry));
  let index = activeIndex;
  let round = activeIndex < 0 ? 1 : scene.round ?? 1;
  for (let step = 0; step < entries.length; step += 1) {
    index += direction;
    if (index >= entries.length) { index = 0; round += 1; }
    if (index < 0) { index = entries.length - 1; round = Math.max(1, round - 1); }
    if (!skip || !isDefeated(scene, entries[index])) break;
  }
  return { initiative: entries.map((entry, i) => ({ ...entry, active: i === index })), round };
}

/**
 * Drop matching entries. When the active entry is among them, the turn passes
 * to the next surviving entry instead of being lost, so removing a defeated
 * creature mid-round does not send the next advance back to the top. An empty
 * order ends the combat and clears the round counter.
 */
export function removeFromTurnOrder(scene: TurnScene, remove: (entry: InitiativeEntry) => boolean): TurnState {
  const entries = scene.initiative;
  const kept = entries.filter((entry) => !remove(entry));
  if (kept.length === entries.length) return { initiative: entries, round: scene.round };
  if (kept.length === 0) return { initiative: kept, round: undefined };
  const activeIndex = entries.findIndex((entry) => entry.active);
  if (activeIndex < 0 || !remove(entries[activeIndex])) return { initiative: kept, round: scene.round };
  const skip = kept.some((entry) => !isDefeated(scene, entry));
  let round = scene.round;
  for (let step = 1; step < entries.length; step += 1) {
    const index = (activeIndex + step) % entries.length;
    if (index === 0 && round !== undefined) round += 1;
    const candidate = entries[index];
    if (remove(candidate) || (skip && isDefeated(scene, candidate))) continue;
    return { initiative: kept.map((entry) => entry.id === candidate.id ? { ...entry, active: true } : entry), round };
  }
  return { initiative: kept, round: scene.round };
}

/**
 * Insert below every entry with an equal or higher value. Existing entries keep
 * their positions, so a DM's manual tie-break order survives later additions.
 */
export function insertByValue(entries: readonly InitiativeEntry[], entry: InitiativeEntry): InitiativeEntry[] {
  const index = entries.findIndex((existing) => existing.value < entry.value);
  return index < 0 ? [...entries, entry] : [...entries.slice(0, index), entry, ...entries.slice(index)];
}
