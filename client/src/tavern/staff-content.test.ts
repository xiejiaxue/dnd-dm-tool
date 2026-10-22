import { describe, expect, it } from 'vitest';
import { STAFF } from './catalog';
import { STAFF_STORIES } from './staff-content';
import { beginDay, dailyTrade, dismissStaff, getStory, newGame, nextDay, observeEncounter, openTavern, parseGame, purchase, resolveEncounter, settleDay, type GameState } from './game';
const morning = () => openTavern(newGame(), '试营业', 'ale');
const plan = { preparation: 'welcome' as const, marketing: 0 as const };
const finish = (state: GameState) => {
  for (const e of state.active!.encounters) if (!e.resolved) state = observeEncounter(state, e.id);
  return settleDay(state);
};
describe('hired staff scenes', () => {
  it('only selects current hires and has a separate one-in-six event check', () => {
    for (const staff of STAFF) {
      expect(STAFF_STORIES[staff.id].talks).toHaveLength(3);
      for (let face = 1; face <= 6; face++) {
        const state = beginDay(purchase(morning(), 'staff', staff.id), plan, () => (face - .5) / 6);
        const scenes = state.active!.encounters.filter(e => e.kind.startsWith('staff'));
        expect(scenes).toHaveLength(face === 1 ? 2 : 1);
        expect(scenes.every(e => e.actor === staff.id)).toBe(true);
        expect(scenes.every(e => getStory(e).name === staff.name)).toBe(true);
        expect(parseGame(JSON.stringify(state))).toEqual(state);
      }
    }
    expect(beginDay(morning(), plan, () => 0).active!.encounters.some(e => e.kind.startsWith('staff'))).toBe(false);
  });
  it('persists dialogue progress, stops on dismissal and resumes after rehiring', () => {
    let state = purchase(morning(), 'staff', 'patric');
    for (let chapter = 0; chapter < 4; chapter++) {
      const day = beginDay(state, plan, () => .5);
      expect(day.active!.encounters.find(e => e.kind === 'staff')!.chapter).toBe(chapter);
      const report = finish(day);
      expect(report.ledger.at(-1)!.journal!.some(e => e.kind === 'staff')).toBe(true);
      state = nextDay(parseGame(JSON.stringify(report))!);
    }
    const dismissed = dismissStaff(state, 'patric');
    const next = beginDay(dismissed, plan, () => 0);
    expect(next.active!.encounters.some(e => e.kind.startsWith('staff'))).toBe(false);
    expect(parseGame(JSON.stringify(dismissed))!.ledger).toEqual(state.ledger);
    const rehired = beginDay(purchase(dismissed, 'staff', 'patric'), plan, () => 0);
    expect(rehired.active!.encounters.find(e => e.kind === 'staff')!.chapter).toBe(3);
  });
  it('does not add employee orders; observation is free and event responses charge once', () => {
    const state = beginDay(purchase(morning(), 'staff', 'mosp'), plan, () => .02);
    const staffEvent = state.active!.encounters.find(e => e.kind === 'staff-event')!;
    const trade = dailyTrade(state);
    expect(trade.orders!.names).toHaveLength(state.active!.visitorRoll);
    const observed = observeEncounter(state, staffEvent.id);
    expect(observed.cash).toBe(state.cash);
    expect(dailyTrade(observed)).toEqual(trade);
    const responded = resolveEncounter(state, staffEvent.id, 'help');
    expect(responded.cash).toBe(state.cash - 100);
    expect(responded.active!.storyCost).toBe(100);
    expect(() => resolveEncounter(responded, staffEvent.id, 'help')).toThrow();
    const report = finish(responded).ledger[0];
    expect(report.net).toBe(report.sales - report.ingredients - report.upkeep - report.wages - 100);
  });
  it('accepts the all daily journal entries and rejects unowned or duplicated staff slots', () => {
    // Three guests; city event; staff conversation; staff event; windfall.
    let n = 0;
    const state = beginDay(purchase(morning(), 'staff', 'mosp'), plan, () => n++ === 0 ? .99 : 0);
    expect(state.active!.encounters).toHaveLength(9);
    const report = finish(state);
    expect(report.ledger[0].journal).toHaveLength(9);
    expect(parseGame(JSON.stringify(report))).toEqual(report);
    const unowned = structuredClone(state);
    unowned.staff = [];
    expect(parseGame(JSON.stringify(unowned))).toBeNull();
    const duplicate = structuredClone(state);
    duplicate.active!.encounters.find(e => e.kind === 'staff-event')!.kind = 'staff';
    expect(parseGame(JSON.stringify(duplicate))).toBeNull();
    const invalid = structuredClone(state);
    invalid.progress['staff:mosp'] = 99;
    expect(parseGame(JSON.stringify(invalid))).toBeNull();
    const legacy = structuredClone(state);
    legacy.active!.encounters = legacy.active!.encounters.filter(e => !e.kind.startsWith('staff'));
    expect(parseGame(JSON.stringify(legacy))).toEqual(legacy);
  });
});
