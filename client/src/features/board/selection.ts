import type { PlayerToken, Token } from '../../types';

export interface SelectionRect { x: number; y: number; w: number; h: number }

export function selectedAfterClick(current: readonly string[], tokenId: string, additive: boolean): string[] {
  if (!additive) return [tokenId];
  return current.includes(tokenId) ? current.filter(id => id !== tokenId) : [...current, tokenId];
}

export function tokensInsideRect(
  tokens: readonly (Token | PlayerToken)[],
  rect: SelectionRect,
): string[] {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  return tokens.flatMap(token => {
    const radius = token.size / 2;
    const intersects = token.x + radius >= rect.x
      && token.x - radius <= right
      && token.y + radius >= rect.y
      && token.y - radius <= bottom;
    return intersects ? [token.id] : [];
  });
}

export function mergedSelection(current: readonly string[], inside: readonly string[], additive: boolean): string[] {
  return additive ? [...new Set([...current, ...inside])] : [...inside];
}

