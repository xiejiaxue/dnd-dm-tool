import { expect, it } from 'vitest';
import { beginDay, getStory, newGame, observeEncounter, openTavern, parseGame, resolveEncounter, settleDay } from './game';
const plan = { preparation: 'welcome' as const, marketing: 0 as const };
const morning = () => openTavern(newGame(), '酒馆', 'ale');
it('triggers on exactly one of the hundred independent daily die faces', () => {
  for (let face = 1; face <= 100; face++) {
    const day = beginDay(morning(), plan, () => (face - .5) / 100);
    expect(day.active!.windfallRoll).toBe(face);
    expect(day.active!.encounters.filter(e => e.kind === 'windfall')).toHaveLength(face === 1 ? 1 : 0);
    expect(parseGame(JSON.stringify(day))).toEqual(day);
  }
});
it('credits exactly ten gp through either recording path and preserves it across reload and settlement', () => {
  for (const useResponse of [false, true]) {
    let day = beginDay(morning(), plan, () => 0);
    const e = day.active!.encounters.find(e => e.kind === 'windfall')!;
    expect(getStory(e).title).toBe('阔绰的顾客');
    expect(day.cash).toBe(50000);
    day = parseGame(JSON.stringify(day))!;
    day = useResponse ? resolveEncounter(day, e.id, 'record') : observeEncounter(day, e.id);
    expect(day.cash).toBe(51000);
    expect(day.active!.storyIncome).toBe(1000);
    day = parseGame(JSON.stringify(day))!;
    expect(() => observeEncounter(day, e.id)).toThrow();
    expect(() => resolveEncounter(day, e.id, 'record')).toThrow();
    for (const item of day.active!.encounters) if (!item.resolved) day = observeEncounter(day, item.id);
    const settled = settleDay(day), report = settled.ledger[0];
    expect(report.net).toBe(report.sales - report.ingredients - report.upkeep + 1000);
    expect(settled.cash).toBe(50000 + report.net);
    expect(parseGame(JSON.stringify(settled))).toEqual(settled);
    expect(report.journal!.some(item => item.title === '阔绰的顾客')).toBe(true);
  }
});
it('rejects inconsistent rare-event rolls and retains legacy in-progress patron counts', () => {
  const day = beginDay(morning(), plan, () => .99);
  const invalid = structuredClone(day);
  invalid.active!.windfallRoll = 1;
  expect(parseGame(JSON.stringify(invalid))).toBeNull();
  const legacy = structuredClone(day);
  delete legacy.active!.patronDie;
  delete legacy.active!.windfallRoll;
  // An existing six-visitor day still imports without changing its count.
  const extra = ['tally', 'fala', 'urchins'].filter(id => !legacy.active!.encounters.some(e => e.actor === id));
  for (const id of extra) legacy.active!.encounters.push({...legacy.active!.encounters[0],id:`old-${id}`,actor:id});
  legacy.active!.visitorRoll = legacy.active!.encounters.filter(e => e.kind === 'patron').length;
  expect(legacy.active!.visitorRoll).toBeGreaterThan(3);
  expect(parseGame(JSON.stringify(legacy))).toEqual(legacy);
});
