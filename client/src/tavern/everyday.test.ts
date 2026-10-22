import { expect, it } from 'vitest';
import { EVERYDAY_EVENTS, everydayPool } from './everyday-content';
import { beginDay, dailyTrade, everydayNet, newGame, observeEncounter, openTavern, parseGame, resolveEncounter, settleDay } from './game';
const start = () => beginDay(openTavern(newGame(), '酒馆', 'ale'), { preparation: 'welcome', marketing: 0 }, () => .5);
it('selects one ordinary customer and one operating event without named prerequisites', () => {
  const state = start();
  const daily = state.active!.encounters.filter(e => e.kind === 'everyday');
  expect(daily).toHaveLength(2);
  expect(daily.map(e => EVERYDAY_EVENTS.find(item => item.id === e.actor)!.group)).toEqual(['customer','operation']);
  expect(parseGame(JSON.stringify(state))).toEqual(state);
  const bad = structuredClone(state);
  bad.active!.encounters.filter(e => e.kind === 'everyday')[1].actor = daily[0].actor;
  expect(parseGame(JSON.stringify(bad))).toBeNull();
});
it('records every outcome once and settles its signed adjustment without changing patron orders', () => {
  for (const item of EVERYDAY_EVENTS) {
    let state = start();
    state.active!.encounters = state.active!.encounters.filter(e => e.kind !== 'everyday');
    const template = state.active!.encounters[0];
    state.active!.encounters.push({...template,id:'daily',kind:'everyday',actor:item.id,chapter:0});
    const trade = dailyTrade(state), cash = state.cash;
    state = observeEncounter(state, 'daily');
    expect(everydayNet(state)).toBe(item.delta);
    expect(state.cash).toBe(cash); // Deferred until closing, including losses at zero cash.
    expect(dailyTrade(state)).toEqual(trade);
    state = parseGame(JSON.stringify(state))!;
    expect(() => observeEncounter(state, 'daily')).toThrow();
    expect(() => resolveEncounter(state, 'daily', 'record')).toThrow();
    for (const e of state.active!.encounters) if (!e.resolved) state = observeEncounter(state, e.id);
    const result = settleDay(state), report = result.ledger[0];
    expect(report.dailyNet).toBe(item.delta);
    expect(report.net).toBe(trade.sales - trade.ingredients - trade.upkeep + item.delta);
    expect(result.cash).toBe(cash + report.net);
    expect(report.journal!.at(0)!.result).toContain('打烊时结算');
    expect(parseGame(JSON.stringify(result))).toEqual(result);
  }
});
it('permits recording losses with no cash and carries unpaid amounts into debt', () => {
  let state = start();
  state.cash = 0; state.active!.openingCash = 0;
  state.active!.extraGuests = -100;
  for (const e of state.active!.encounters) {
    if (e.kind === 'everyday') e.actor = EVERYDAY_EVENTS.find(item => item.group === (e === state.active!.encounters.at(-1) ? 'operation' : 'customer') && item.delta < 0)!.id;
    state = observeEncounter(state,e.id);
  }
  expect(parseGame(JSON.stringify(state))).toEqual(state);
  const result = settleDay(state);
  expect(result.cash).toBe(0);
  expect(result.debt).toBe(-result.ledger[0].net);
});

it('has positive expected profit in both daily groups while retaining losses', () => {
  const expected = { customer: 20, operation: 15.625 };
  for (const group of ['customer', 'operation'] as const) {
    const pool = everydayPool(group);
    expect(pool.filter(e => e.delta > 0).length / pool.length).toBe(.75);
    expect(pool.some(e => e.delta < 0)).toBe(true);
    expect(pool.reduce((sum, e) => sum + e.delta, 0) / pool.length).toBe(expected[group]);
  }
  expect(expected.customer + expected.operation).toBe(35.625);
});
