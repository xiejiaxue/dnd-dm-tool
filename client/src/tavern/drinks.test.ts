import { describe, expect, it } from 'vitest';
import { DRINKS, drinkIndex, orderLines, orderTotals, validOrders } from './drinks';
import { beginDay, dailyTrade, newGame, observeEncounter, openTavern, parseGame, settleDay, nextDay } from './game';
const plan = { preparation: 'welcome' as const, marketing: 0 as const };
const start = () => beginDay(openTavern(newGame(), '酒馆', 'ale'), plan, () => .5);
describe('drink orders', () => {
  it('covers every d20 tier boundary and d6 item boundary', () => {
    for (const [roll, base] of [[1,0],[10,0],[11,2],[16,2],[17,4],[19,4],[20,6]]) {
      expect(drinkIndex([roll,1])).toBe(base);
      expect(drinkIndex([roll,3])).toBe(base);
      expect(drinkIndex([roll,4])).toBe(base + 1);
      expect(drinkIndex([roll,6])).toBe(base + 1);
    }
  });
  it('persists dice, reconciles individual orders and settles only once', () => {
    let state = start();
    state.active!.drinkDice = Array.from({length:80}, (_,i) => [i % 20 + 1,i % 6 + 1]);
    const saved = parseGame(JSON.stringify(state))!;
    const trade = dailyTrade(saved);
    const lines = orderLines(trade.orders!);
    expect(trade.orders).toEqual(dailyTrade(state).orders);
    expect(lines).toHaveLength(trade.guests);
    expect(trade.sales).toBe(lines.reduce((n,l) => n + l.total,0));
    expect(trade.ingredients).toBe(lines.reduce((n,l) => n + l.drink.cost + 18,0));
    const opening = state.cash;
    for (const e of state.active!.encounters) state = observeEncounter(state,e.id);
    const report = settleDay(state);
    expect(report.cash).toBe(opening + (report.ledger[0].dailyNet ?? 0) + trade.sales - trade.ingredients - trade.upkeep - trade.wages);
    expect(report.ledger[0].orders).toEqual(trade.orders);
    expect(parseGame(JSON.stringify(report))).toEqual(report);
    expect(() => settleDay(report)).toThrow();
  });
  it('uses tea for children, rejects tampered orders and preserves legacy accounting', () => {
    const state = start();
    state.active!.encounters[0].actor = 'urchins';
    const orders = dailyTrade(state).orders!;
    expect(orderLines(orders)[0].drink.id).toBe('tea');
    expect(validOrders(orders)).toBe(true);
    expect(validOrders({...orders,dice:[[21,1]]})).toBe(false);
    delete state.active!.drinkDice;
    expect(dailyTrade(state).orders).toBeUndefined();
    const legacy = dailyTrade(state);
    expect(legacy.sales).toBe(legacy.guests * legacy.ticket);
    const malformed = start(); malformed.active!.drinkDice![0] = [0,7];
    expect(parseGame(JSON.stringify(malformed))).toBeNull();
    const clean = start();
    let done = clean; for (const e of clean.active!.encounters) done = observeEncounter(done,e.id);
    done = settleDay(done); done.ledger[0].sales++;
    expect(parseGame(JSON.stringify(done))).toBeNull();
  });
  it('keeps snapshot prices and a sixty-day backup within the import size limit', () => {
    let state = {...openTavern(newGame(),'酒馆','ale'),freePlay:true};
    for (let day=0;day<60;day++) {
      state = beginDay(state,plan,() => .99);
      for (const e of state.active!.encounters) state = observeEncounter(state,e.id);
      state = nextDay(settleDay(state));
    }
    expect(new TextEncoder().encode(JSON.stringify(state)).length).toBeLessThan(500000);
    expect(parseGame(JSON.stringify(state))).toEqual(state);
    const orders = structuredClone(state.ledger[0].orders!);
    orders.menu[7].price += 100;
    expect(orderTotals(orders).sales).toBeGreaterThan(state.ledger[0].sales);
    expect(DRINKS[7].price).toBe(200);
  });
});
