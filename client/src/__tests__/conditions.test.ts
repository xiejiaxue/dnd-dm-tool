import { describe, expect, it } from 'vitest';
import { setConditionDuration, toggleCondition } from '../features/conditions/model';

describe('token conditions', () => {
  it('adds and removes one stable condition without mutating the source', () => {
    const source = { conditions: [{ id: 'prone' as const, remainingRounds: null }] };
    const added = toggleCondition(source, 'stunned', 2);
    expect(added).toEqual([
      { id: 'prone', remainingRounds: null },
      { id: 'stunned', remainingRounds: 2 },
    ]);
    expect(source.conditions).toEqual([{ id: 'prone', remainingRounds: null }]);
    expect(toggleCondition({ conditions: added }, 'prone')).toEqual([{ id: 'stunned', remainingRounds: 2 }]);
  });

  it('changes a duration without changing unrelated markers', () => {
    expect(setConditionDuration([
      { id: 'prone', remainingRounds: null },
      { id: 'concentrating', remainingRounds: 3 },
    ], 'concentrating', 1)).toEqual([
      { id: 'prone', remainingRounds: null },
      { id: 'concentrating', remainingRounds: 1 },
    ]);
  });
});

