import { expect, it } from 'vitest';
import { newGame, openTavern, beginDay, setAvailableCash, parseGame, observeEncounter, settleDay } from './game';
it('sets balances including zero while preserving business records and rejecting invalid values', () => {
  const game = newGame();
  for (const amount of [0, 12345, 100000000]) {
    const changed = setAvailableCash(game, amount);
    expect(changed).toEqual({ ...game, cash: amount });
    expect(parseGame(JSON.stringify(changed))).toEqual(changed);
  }
  for (const bad of [-1, .5, NaN, Infinity, 100000001]) expect(() => setAvailableCash(game, bad)).toThrow();
});
it('keeps repeated mid-day corrections through reload and settlement without changing operating profit', () => {
  let baseline = beginDay(openTavern(newGame(), '金币验证', 'ale'), { preparation: 'welcome', marketing: 300 }, () => .5);
  for (const event of baseline.active!.encounters) baseline = observeEncounter(baseline, event.id);
  let edited = setAvailableCash(baseline, 12345);
  edited = setAvailableCash(edited, 20000);
  expect(edited.active!.encounters).toEqual(baseline.active!.encounters);
  expect(parseGame(JSON.stringify(edited))).toEqual(edited);
  const expected = settleDay(baseline);
  const settled = settleDay(edited);
  expect(settled.totalProfit).toBe(expected.totalProfit);
  expect(settled.ledger[0].net).toBe(expected.ledger[0].net);
  expect(settled.cash).toBe(expected.cash + 20000 - baseline.cash);
  expect(parseGame(JSON.stringify(settled))).toEqual(settled);
  expect(setAvailableCash(settled, 0).ledger).toEqual(settled.ledger);
  for (const bad of [1.5, '12', 100000001]) {
    expect(parseGame(JSON.stringify({ ...edited, active: { ...edited.active, cashAdjustment: bad } }))).toBeNull();
    expect(parseGame(JSON.stringify({ ...settled, ledger: [{ ...settled.ledger[0], cashAdjustment: bad }] }))).toBeNull();
  }
});
