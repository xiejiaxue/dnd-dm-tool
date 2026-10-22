import type { Token, TokenCondition, TokenConditionId } from '../../types';

export interface ConditionDefinition {
  id: TokenConditionId;
  label: string;
  badge: string;
  tone: string;
}

export const CONDITION_DEFINITIONS: readonly ConditionDefinition[] = [
  { id: 'prone', label: '倒伏', badge: '倒', tone: '#f59e0b' },
  { id: 'grappled', label: '被擒抱', badge: '擒', tone: '#fb923c' },
  { id: 'restrained', label: '束缚', badge: '缚', tone: '#f97316' },
  { id: 'stunned', label: '震慑', badge: '晕', tone: '#eab308' },
  { id: 'unconscious', label: '昏迷', badge: '昏', tone: '#a78bfa' },
  { id: 'invisible', label: '隐形', badge: '隐', tone: '#38bdf8' },
  { id: 'concentrating', label: '专注', badge: '专', tone: '#34d399' },
  { id: 'dead', label: '战败', badge: '亡', tone: '#ef4444' },
] as const;

const DEFINITIONS = new Map(CONDITION_DEFINITIONS.map(definition => [definition.id, definition]));

export function conditionDefinition(id: TokenConditionId): ConditionDefinition {
  return DEFINITIONS.get(id) ?? { id, label: id, badge: id.slice(0, 1), tone: '#a1a1aa' };
}

export function toggleCondition(
  token: Pick<Token, 'conditions'>,
  id: TokenConditionId,
  remainingRounds: number | null = null,
): TokenCondition[] {
  const current = token.conditions ?? [];
  if (current.some(condition => condition.id === id)) return current.filter(condition => condition.id !== id);
  return [...current, { id, remainingRounds }];
}

export function setConditionDuration(
  conditions: readonly TokenCondition[] | undefined,
  id: TokenConditionId,
  remainingRounds: number | null,
): TokenCondition[] {
  return (conditions ?? []).map(condition => condition.id === id ? { ...condition, remainingRounds } : { ...condition });
}

