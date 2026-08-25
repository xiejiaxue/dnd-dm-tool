import { describe, expect, it } from 'vitest';
import { encounterTokens, selectedEncounterTokenId } from '../features/encounter/combatants';
import type { Token } from '../types';

function token(id: string, kind: Token['kind']): Token {
  return { id, kind, name: id, entryId: null, x: 0, y: 0, size: 100, avatar: '', color: '#fff' };
}

describe('encounter combatants', () => {
  it('lists NPCs beside monsters but excludes player tokens', () => {
    expect(encounterTokens([
      token('goblin', 'monster'),
      token('joe', 'npc'),
      token('hero', 'player'),
    ]).map(item => item.id)).toEqual(['goblin', 'joe']);
  });

  it('links a board selection only when it belongs to an encounter row', () => {
    const combatants = encounterTokens([
      token('goblin', 'monster'),
      token('joe', 'npc'),
      token('hero', 'player'),
    ]);

    expect(selectedEncounterTokenId(combatants, 'goblin')).toBe('goblin');
    expect(selectedEncounterTokenId(combatants, 'joe')).toBe('joe');
    expect(selectedEncounterTokenId(combatants, 'hero')).toBeNull();
    expect(selectedEncounterTokenId(combatants, 'missing')).toBeNull();
    expect(selectedEncounterTokenId(combatants, null)).toBeNull();
  });
});
