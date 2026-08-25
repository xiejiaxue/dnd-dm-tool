import type { Token } from '../../types';

export type EncounterToken = Token & { kind: 'monster' | 'npc' };

export function isEncounterToken(token: Token): token is EncounterToken {
  return token.kind === 'monster' || token.kind === 'npc';
}

export function encounterTokens(tokens: readonly Token[]): EncounterToken[] {
  return tokens.filter(isEncounterToken);
}

export function selectedEncounterTokenId(
  tokens: readonly EncounterToken[],
  selectedTokenId: string | null | undefined,
): string | null {
  if (!selectedTokenId) return null;
  return tokens.some(token => token.id === selectedTokenId) ? selectedTokenId : null;
}
