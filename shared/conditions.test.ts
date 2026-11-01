import { describe, expect, it } from 'vitest';
import { normalizeConditions, setConditionRounds, tickConditionsForActiveTurn, toggleCondition } from './conditions';
import type { InitiativeEntry, PlayerToken, Token } from './types';

const piece = (id: string, conditions?: Token['conditions']): Token => ({ id, kind: 'monster', name: id, entryId: null, x: 0, y: 0, size: 100, avatar: '', color: '#000', ...(conditions ? { conditions } : {}) });
const entry = (tokenId: string, active: boolean): InitiativeEntry => ({ id: `i-${tokenId}`, name: tokenId, value: 10, source: 'dm', sessionId: null, tokenId, active });

describe('token conditions', () => {
  it('keeps one entry per condition in catalogue order', () => {
    expect(normalizeConditions([{ id: 'prone' }, { id: 'blinded', rounds: 2 }, { id: 'prone', rounds: 1 }])).toEqual([{ id: 'blinded', rounds: 2 }, { id: 'prone', rounds: 1 }]);
    const added = toggleCondition([{ id: 'prone' }], 'charmed');
    expect(added).toEqual([{ id: 'charmed' }, { id: 'prone' }]);
    expect(toggleCondition(added, 'prone')).toEqual([{ id: 'charmed' }]);
    expect(setConditionRounds(added, 'prone', 3)).toEqual([{ id: 'charmed' }, { id: 'prone', rounds: 3 }]);
    expect(setConditionRounds([{ id: 'prone', rounds: 3 }], 'prone', undefined)).toEqual([{ id: 'prone' }]);
  });

  it('counts down only the creature whose turn begins and ends conditions at zero', () => {
    const goblin = piece('goblin', [{ id: 'poisoned', rounds: 2 }, { id: 'stunned', rounds: 1 }, { id: 'prone' }]);
    const orc = piece('orc', [{ id: 'blinded', rounds: 1 }]);
    const hero: PlayerToken = { ...piece('hero', [{ id: 'concentrating', rounds: 1 }]), kind: 'player', sessionId: 'u' };
    const ticked = tickConditionsForActiveTurn({ initiative: [entry('goblin', true), entry('orc', false)], tokens: [goblin, orc], players: [hero] });
    expect(ticked.tokens[0].conditions).toEqual([{ id: 'poisoned', rounds: 1 }, { id: 'prone' }]);
    expect(ticked.tokens[1]).toBe(orc);
    expect(ticked.players[0]).toBe(hero);
    const heroTurn = tickConditionsForActiveTurn({ initiative: [entry('hero', true)], tokens: [], players: [hero] });
    expect(heroTurn.players[0].conditions).toEqual([]);
  });
});
