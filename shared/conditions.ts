import type { PlayerToken, Scene, Token } from './types';

/** The fifteen 5e conditions plus concentration, each with a one-character board badge. */
export const CONDITIONS = [
  { id: 'blinded', label: '目盲', badge: '盲', color: '#5b5f66' },
  { id: 'charmed', label: '魅惑', badge: '魅', color: '#b4467a' },
  { id: 'deafened', label: '耳聋', badge: '聋', color: '#6b6f76' },
  { id: 'exhaustion', label: '力竭', badge: '竭', color: '#7a5a36' },
  { id: 'frightened', label: '恐慌', badge: '惧', color: '#6a3fa0' },
  { id: 'grappled', label: '受擒', badge: '擒', color: '#9a6a1c' },
  { id: 'incapacitated', label: '失能', badge: '失', color: '#4a4d52' },
  { id: 'invisible', label: '隐形', badge: '隐', color: '#3f7f99' },
  { id: 'paralyzed', label: '麻痹', badge: '麻', color: '#c08a10' },
  { id: 'petrified', label: '石化', badge: '石', color: '#777366' },
  { id: 'poisoned', label: '中毒', badge: '毒', color: '#3d8a3d' },
  { id: 'prone', label: '倒地', badge: '倒', color: '#8a4b2a' },
  { id: 'restrained', label: '束缚', badge: '缚', color: '#8c5a1e' },
  { id: 'stunned', label: '震慑', badge: '慑', color: '#c26a00' },
  { id: 'unconscious', label: '昏迷', badge: '昏', color: '#20221e' },
  { id: 'concentrating', label: '专注', badge: '专', color: '#2b5fa8' },
] as const;

export type ConditionId = (typeof CONDITIONS)[number]['id'];

export interface TokenCondition {
  id: ConditionId;
  /** Rounds left; counts down at the start of the token's own turn and ends at 0. Absent = until removed. */
  rounds?: number;
}

export const MAX_CONDITION_ROUNDS = 100;
const byId = new Map<string, (typeof CONDITIONS)[number]>(CONDITIONS.map((condition) => [condition.id, condition]));

export function conditionInfo(id: string) {
  return byId.get(id);
}

export function isConditionId(value: unknown): value is ConditionId {
  return typeof value === 'string' && byId.has(value);
}

/** Conditions in the catalogue order, one entry per id. */
export function normalizeConditions(conditions: readonly TokenCondition[]): TokenCondition[] {
  const latest = new Map(conditions.map((condition) => [condition.id, condition]));
  return CONDITIONS.flatMap(({ id }) => {
    const condition = latest.get(id);
    return condition ? [condition.rounds === undefined ? { id } : { id, rounds: condition.rounds }] : [];
  });
}

/** Adds the condition, or removes it when it is already on the token. */
export function toggleCondition(conditions: readonly TokenCondition[] | undefined, id: ConditionId): TokenCondition[] {
  const current = conditions ?? [];
  return current.some((condition) => condition.id === id)
    ? current.filter((condition) => condition.id !== id)
    : normalizeConditions([...current, { id }]);
}

export function setConditionRounds(conditions: readonly TokenCondition[] | undefined, id: ConditionId, rounds: number | undefined): TokenCondition[] {
  return (conditions ?? []).map((condition) => condition.id !== id ? condition : rounds === undefined ? { id } : { id, rounds });
}

type TickScene = Pick<Scene, 'initiative' | 'tokens' | 'players'>;

/**
 * Called after the turn has moved forward: the creature now acting loses one
 * round from each timed condition, and conditions reaching 0 end. Both the room
 * and the browser's optimistic reducer run this, so they agree on the result.
 */
export function tickConditionsForActiveTurn(scene: TickScene): Pick<Scene, 'tokens' | 'players'> {
  const tokenId = scene.initiative.find((entry) => entry.active)?.tokenId;
  const tick = <T extends Token | PlayerToken>(token: T): T => {
    if (token.id !== tokenId || !token.conditions?.some((condition) => condition.rounds !== undefined)) return token;
    const conditions = token.conditions.flatMap((condition) => {
      if (condition.rounds === undefined) return [condition];
      return condition.rounds > 1 ? [{ id: condition.id, rounds: condition.rounds - 1 }] : [];
    });
    return { ...token, conditions };
  };
  return { tokens: scene.tokens.map(tick), players: scene.players.map(tick) };
}
