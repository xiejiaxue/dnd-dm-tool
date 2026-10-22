import { expect, it } from 'vitest';
import { dayIndex, DAYS } from '../../../shared/calendar/model';
import { seedEvents } from '../../../worker/src/calendar';
import { newGame, parseGame } from './game';
import { CAMPAIGN_START_DAY, tavernDate, todayPublicEvents } from './date';
it('maps opening to Ches20, parade to day2 and hides day3 fireball', () => {
  expect(tavernDate(1).date.key).toBe('3-20');
  expect(todayPublicEvents(seedEvents(), 2).map(e => e.id)).toEqual(['parades']);
  expect(todayPublicEvents(seedEvents(), 3)).toEqual([]);
  expect(tavernDate(12).date.key).toBe('4-1');
});
it('handles holidays and future years without repeating one-off campaign events', () => {
  expect(tavernDate(2, dayIndex(7, 30)).date.label).toBe('仲夏节');
  expect(tavernDate(3, dayIndex(7, 30)).date.label).toBe('盾会');
  expect(tavernDate(4, dayIndex(7, 30)).date.key).toBe('8-1');
  expect(tavernDate(367, 0)).toMatchObject({ year: 1493, date: { key: '1-1' } });
  expect(tavernDate(732, 0)).toMatchObject({ year: 1494, date: { key: '1-1' } });
  expect(todayPublicEvents(seedEvents(), 368)).toEqual([]);
});
it('preserves old tavern saves and validates date fields in backups', () => {
  const game = newGame();
  expect(parseGame(JSON.stringify(game))).not.toBeNull();
  expect(parseGame(JSON.stringify({ ...game, calendarStartDay: 0 }))?.calendarStartDay).toBe(0);
  for (const bad of [-1, DAYS.length, 1.5, '80']) expect(parseGame(JSON.stringify({ ...game, calendarStartDay: bad }))).toBeNull();
});

it('advances preparation days without charging cash, adding business days or creating bills', async () => {
  const { advanceCalendarDay, openTavern, beginDay, nextDay, continuePlaying } = await import('./game');
  const original = newGame();
  const skipped = advanceCalendarDay(advanceCalendarDay({ ...original, cash: 0 }));
  expect(skipped).toEqual({ ...original, cash: 0, calendarSkippedDays: 2 });
  expect(parseGame(JSON.stringify(skipped))).toEqual(skipped);
  expect(tavernDate(skipped.day + skipped.calendarSkippedDays!).date.key).toBe('3-22');
  const planning = openTavern(original, original.name, original.style);
  expect(advanceCalendarDay(planning).day).toBe(1);
  const running = beginDay(planning, { preparation: 'welcome', marketing: 0 }, () => 0.5);
  expect(() => advanceCalendarDay(running)).toThrow();
  expect(() => advanceCalendarDay({ ...planning, phase: 'report' })).toThrow();
  expect(nextDay({ ...skipped, phase: 'report' }).calendarSkippedDays).toBe(2);
  expect(continuePlaying({ ...skipped, phase: 'finished' }).calendarSkippedDays).toBe(2);
  for (const bad of [-1, 100000, 1.5, '2']) expect(parseGame(JSON.stringify({ ...original, calendarSkippedDays: bad }))).toBeNull();
});

it('rewinds and selects dates independently of business records, then continues from there', async () => {
  const { advanceCalendarDay, calendarElapsedDay, setCalendarDate } = await import('./game');
  const original = advanceCalendarDay(advanceCalendarDay(newGame()));
  const reset = setCalendarDate(original, CAMPAIGN_START_DAY);
  expect(tavernDate(calendarElapsedDay(reset), reset.calendarStartDay).date.key).toBe('3-1');
  expect({ ...reset, calendarAdjustment: undefined }).toEqual({ ...original, calendarAdjustment: undefined });
  expect(parseGame(JSON.stringify(reset))).toEqual(reset);
  expect(tavernDate(calendarElapsedDay(advanceCalendarDay(reset))).date.key).toBe('3-2');
  expect(tavernDate(calendarElapsedDay(setCalendarDate(reset, 0))).date.key).toBe('1-1');
  expect(() => setCalendarDate(reset, -1)).toThrow();
  expect(parseGame(JSON.stringify({ ...original, calendarAdjustment: -999999 }))).toBeNull();
});

it('keeps the calendar synchronized through a full trading day and the thirty-day review', async () => {
  const { openTavern, beginDay, observeEncounter, settleDay, nextDay, continuePlaying, calendarElapsedDay, setCalendarDate } = await import('./game');
  let game = setCalendarDate(openTavern(newGame(), '同步测试', 'ale'), dayIndex(3, 20));
  const initial = calendarElapsedDay(game);
  game = beginDay(game, { preparation: 'welcome', marketing: 0 }, () => 0.5);
  for (const encounter of game.active!.encounters) game = observeEncounter(game, encounter.id);
  expect(calendarElapsedDay(game)).toBe(initial);
  game = settleDay(game);
  expect(calendarElapsedDay(game)).toBe(initial);
  game = nextDay(game);
  expect(calendarElapsedDay(game)).toBe(initial + 1);
  expect(todayPublicEvents(seedEvents(), calendarElapsedDay(game), game.calendarStartDay).map(e => e.id)).toContain('parades');
  const end = { ...game, day: 30, phase: 'report' as const };
  const review = nextDay(end);
  expect(calendarElapsedDay(review)).toBe(calendarElapsedDay(end));
  expect(calendarElapsedDay(continuePlaying(review))).toBe(calendarElapsedDay(end) + 1);
});

it('locks trading and settlement dates across manual changes, backups, holidays and year rollover', async () => {
  const { openTavern, beginDay, observeEncounter, settleDay, setCalendarDate } = await import('./game');
  const { recordedDateLabel } = await import('./date');
  const holiday = dayIndex(7, 30) + 2;
  let game = beginDay(setCalendarDate(openTavern(newGame(), '留档测试', 'ale'), holiday), { preparation: 'welcome', marketing: 0 }, () => .5);
  expect(recordedDateLabel(game.active!.calendarDay)).toBe('1492 DR · 盾会');
  game = setCalendarDate(game, 366);
  for (const encounter of game.active!.encounters) game = observeEncounter(game, encounter.id);
  game = settleDay(game);
  expect(game.ledger[0].calendarDay).toBe(holiday);
  expect(parseGame(JSON.stringify(game))!.ledger[0].calendarDay).toBe(holiday);
  const historical = setCalendarDate(game, 0);
  expect(historical.ledger[0].calendarDay).toBe(holiday);
  expect(recordedDateLabel(366)).toBe('1493 DR · 严冬之月 1日');
  const legacy = JSON.parse(JSON.stringify(game));
  delete legacy.ledger[0].calendarDay;
  expect(parseGame(JSON.stringify(legacy))).not.toBeNull();
  expect(recordedDateLabel(parseGame(JSON.stringify(legacy))!.ledger[0].calendarDay)).toContain('旧存档');
  for (const bad of [-1, 1.5, '81', 2000001]) {
    legacy.ledger[0].calendarDay = bad;
    expect(parseGame(JSON.stringify(legacy))).toBeNull();
  }
});
