import { expect, it } from 'vitest';
import { newGame, openTavern, returnToSetup, advanceCalendarDay, parseGame, addOtherIncome } from './game';
it('returns to registration without resetting funds, date or existing progress', () => {
  const original = addOtherIncome(advanceCalendarDay(newGame()), '任务报酬', 12345);
  const opened = openTavern(original, '冒险者酒馆', 'ale');
  const returned = returnToSetup(opened);
  expect(returned).toEqual({ ...opened, phase: 'setup' });
  expect(parseGame(JSON.stringify(returned))).toEqual(returned);
  expect(openTavern(returned, returned.name, returned.style)).toEqual(opened);
  for (const phase of ['setup', 'running', 'report', 'finished'] as const) expect(() => returnToSetup({ ...opened, phase })).toThrow();
});
