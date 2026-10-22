import { FACTION_PATRONS, FACTION_EVENTS } from './faction-content';
import { describe, expect, it } from 'vitest';
import { EVENTS, PATRONS, STAFF } from './catalog';
import { beginDay, dismissStaff, skillBonus, addOtherIncome, styleUnlocked, changeStyle, observeEncounter, journalEntries, continuePlaying, dailyTrade, getStory, newGame, nextDay, openTavern, parseGame, purchase, repayDebt, resolveEncounter, settleDay, type GameState, type Random } from './game';

const planning = () => openTavern(newGame(), '暖灯', 'ale');
const plan = { preparation: 'welcome' as const, marketing: 300 as const };
const fixed = (values: number[]): Random => { let i = 0; return () => values[i++ % values.length]; };
function finishInteractions(state: GameState, random: Random = () => .9): GameState {
  for (const e of state.active!.encounters) {
    if (e.resolved) continue;
    const option = getStory(e).choices.find(c => c.cost === 0)!;
    state = resolveEncounter(state, e.id, option.id, random);
  }
  return state;
}
describe('tavern game', () => {
  it('changes style before service, persists it, and uses it without altering past accounts', () => {
    const previous = settleDay(finishInteractions(beginDay(planning(), plan, () => .5)));
    const morning = purchase(nextDay(previous), 'staff', 'lillian');
    const changed = changeStyle(morning, 'tea');
    expect(changed.cash).toBe(morning.cash);
    expect(changed.ledger).toEqual(previous.ledger);
    expect(parseGame(JSON.stringify(changed))?.style).toBe('tea');
    const teaDay = beginDay(changed, plan, () => .5);
    const jazzDay = beginDay(morning, plan, () => .5);
    expect(dailyTrade(teaDay).ticket - dailyTrade(jazzDay).ticket).toBe(10);
    expect(dailyTrade(teaDay).guests - dailyTrade(jazzDay).guests).toBe(-4);
    expect(() => changeStyle(teaDay, 'ale')).toThrow();
    expect(() => changeStyle(previous, 'ale')).toThrow();
    expect(() => changeStyle(morning, 'invalid' as GameState['style'])).toThrow();
    expect(nextDay(settleDay(finishInteractions(teaDay))).style).toBe('tea');
  });
  it('keeps the investment available at opening and prevents purchases during service', () => {
    let state = planning();
    expect(state.cash).toBe(50000);
    expect(() => openTavern(state, 'again', 'ale')).toThrow();
    state = purchase(state, 'staff', 'mosp');
    expect(state.cash).toBe(48250);
    expect(() => purchase(state, 'staff', 'mosp')).toThrow();
    state = beginDay(state, plan);
    expect(() => purchase(state, 'upgrade', 'stage')).toThrow();
  });
  it('generates one to three distinct patrons and events only on the event die result of one', () => {
    for (let face = 1; face <= 6; face++) {
      const r = (face - .5) / 6;
      const state = beginDay(planning(), plan, fixed([r,r,.5,.5,.5,.5]));
      const visitors = state.active!.encounters.filter(e => e.kind === 'patron');
      expect(visitors).toHaveLength(Math.ceil(face / 2));
      expect(new Set(visitors.map(v => v.actor)).size).toBe(Math.ceil(face / 2));
      expect(state.active!.encounters.filter(e => e.kind === 'event')).toHaveLength(face === 1 ? 1 : 0);
    }
  });
  it('blocks duplicate actions and settling with unresolved stories', () => {
    const started = beginDay(planning(), plan, () => 0);
    expect(() => settleDay(started)).toThrow('先处理');
    expect(() => beginDay(started, plan)).toThrow();
    const e = started.active!.encounters[0];
    const option = getStory(e).choices[0];
    const resolved = resolveEncounter(started, e.id, option.id, () => .99);
    expect(() => resolveEncounter(resolved, e.id, option.id)).toThrow('已经处理');
    const report = settleDay(finishInteractions(resolved));
    expect(() => settleDay(report)).toThrow();
  });
  it('reconciles advertising, immediate story cash and settlement without charging twice', () => {
    let state = beginDay(planning(), plan, () => 0);
    for (const e of state.active!.encounters) state = resolveEncounter(state, e.id, getStory(e).choices[0].id, () => .99);
    const day = state.active!;
    const trade = dailyTrade(state);
    expect(state.cash).toBe(day.openingCash - day.marketing - day.storyCost + day.storyIncome);
    const expected = state.cash + trade.sales - trade.ingredients - trade.upkeep - trade.wages;
    const result = settleDay(state), report = result.ledger[0];
    expect(result.cash).toBe(expected);
    expect(report.net).toBe(report.sales + report.storyIncome - report.ingredients - report.upkeep - report.wages - report.marketing - report.storyCost);
    expect(report.openingCash + report.net + report.newDebt).toBe(report.closingCash);
    expect(parseGame(JSON.stringify(result))).toEqual(result);
  });
  it('pays feature staff wages once and honors upgrades in the daily trade', () => {
    const base = beginDay(planning(), plan, () => .6);
    const hired = beginDay(purchase(planning(), 'staff', 'mosp'), plan, () => .6);
    expect(dailyTrade(hired).wages).toBe(STAFF[0].wage);
    expect(dailyTrade(hired).guests - dailyTrade(base).guests).toBe(4);
    const upgraded = beginDay(purchase(planning(), 'upgrade', 'stage'), plan, () => .6);
    expect(dailyTrade(upgraded).guests - dailyTrade(base).guests).toBe(5);
  });
  it('advances a patron through three chapters then uses repeat visits', () => {
    let state = planning();
    for (let day = 1; day <= 4; day++) {
      state = beginDay(state, { preparation: 'watch', marketing: 0 }, () => .4);
      const target = state.active!.encounters.find(e => e.kind === 'patron')!;
      const story = getStory(target);
      const patron = PATRONS.find(p => p.id === target.actor)!;
      expect(story.title).toBe(day <= 3 ? patron.chapters[day - 1].title : patron.returnVisit.title);
      state = finishInteractions(state);
      expect(state.progress[target.actor]).toBe(Math.min(day, 3));
      state = nextDay(settleDay(state));
    }
  });
  it('rejects unaffordable spending and carries unpaid service costs as debt', () => {
    const empty = { ...planning(), cash: 0, debt: 10000, reputation: 0, staff: ['reynardo'] };
    expect(() => beginDay(empty, plan)).toThrow('金币不足');
    expect(() => purchase(empty, 'staff', 'mosp')).toThrow('金币不足');
    let state = beginDay(empty, { preparation: 'watch', marketing: 0 }, () => .02);
    const event = state.active!.encounters.find(e => e.kind === 'event')!;
    expect(() => resolveEncounter(state, event.id, getStory(event).choices[0].id)).toThrow('金币不足');
    state = finishInteractions(state, () => 0);
    const result = settleDay(state);
    expect(result.cash).toBe(0);
    expect(result.debt).toBeGreaterThan(0);
    expect(result.ledger[0].newDebt).toBe(-result.ledger[0].net);
    const paid = repayDebt({ ...nextDay(result), cash: result.debt + 100 });
    expect(paid.debt).toBe(0); expect(paid.cash).toBe(100);
  });
  it('restores a mid-day save without rerolling and rejects malformed saves', () => {
    const started = beginDay(planning(), plan, () => .2);
    const raw = JSON.stringify(started);
    expect(parseGame(raw)).toEqual(started);
    for (const invalid of ['{}', '{', JSON.stringify({ ...started, cash: -1 }), JSON.stringify({ ...started, staff: ['unknown'] }), JSON.stringify({ ...started, active: { ...started.active, visitorRoll: 12 } }), JSON.stringify({ ...started, progress: {} }), JSON.stringify({ ...started, active: { ...started.active, encounters: [{ bad: true }] } })]) expect(parseGame(invalid)).toBeNull();
  });
  it('retains actual resolution order when the player chooses visitors out of order', () => {
    let state = beginDay(planning(), plan, () => .5);
    const last = state.active!.encounters.at(-1)!;
    state = resolveEncounter(state, last.id, getStory(last).choices.find(c => c.cost === 0)!.id);
    const first = state.active!.encounters[0];
    state = resolveEncounter(state, first.id, getStory(first).choices.find(c => c.cost === 0)!.id);
    expect(state.active!.encounters.find(e => e.id === last.id)?.resolvedOrder).toBe(1);
    expect(state.active!.encounters.find(e => e.id === first.id)?.resolvedOrder).toBe(2);
    expect(parseGame(JSON.stringify(state))).toEqual(state);
  });
  it('completes a thirty-day run, preserves the ledger and allows free play', () => {
    let state = planning();
    const rng = fixed([.65,.3,.8,.35,.55,.9,.2,.5]);
    for (let day = 1; day <= 30; day++) {
      state = beginDay(state, { preparation: 'special', marketing: 0 }, rng);
      state = finishInteractions(state, rng);
      state = settleDay(state);
      expect(parseGame(JSON.stringify(state))).toEqual(state);
      expect(state.ledger.at(-1)?.day).toBe(day);
      state = nextDay(state);
    }
    expect(state.phase).toBe('finished');
    expect(state.ledger).toHaveLength(30);
    const next = continuePlaying(state);
    expect(next.day).toBe(31); expect(next.phase).toBe('planning'); expect(next.freePlay).toBe(true);
    expect(() => continuePlaying({ ...state, debt: 15000 })).toThrow('停业');
  });
  it('each narrative has a no-cash option and success/failure messages', () => {
    for (const story of [...PATRONS.flatMap(p => [...p.chapters, p.returnVisit]), ...EVENTS]) {
      expect(story.choices.some(c => c.cost === 0)).toBe(true);
      for (const c of story.choices) { expect(c.successText).toBeTruthy(); if (c.skill) expect(c.failureText).toBeTruthy(); }
    }
  });
});

describe('tavern journal', () => {
  it('records without rewards, keeps event labels and actual order across settlement and reload', () => {
    let state = beginDay(planning(), plan, () => .02);
    state.active!.encounters = state.active!.encounters.filter(e => e.kind !== 'everyday'); // Legacy day without everyday scenes.
    const cash = state.cash, reputation = state.reputation;
    const event = state.active!.encounters.find(e => e.kind === 'event')!;
    const patron = state.active!.encounters.find(e => e.kind === 'patron')!;
    state = observeEncounter(state, patron.id);
    expect(() => observeEncounter(state, patron.id)).toThrow();
    state = observeEncounter(state, event.id);
    expect(state.cash).toBe(cash);
    expect(state.reputation).toBe(reputation);
    expect(state.active!.storyCost).toBe(0);
    expect(state.active!.storyIncome).toBe(0);
    expect(state.active!.encounters.every(e => e.roll === null)).toBe(true);
    const entries = journalEntries(state.active!.encounters);
    expect(entries.map(e => e.kind)).toEqual(['patron','event']);
    state = settleDay(state);
    expect(state.ledger[0].journal).toEqual(entries);
    expect(nextDay(parseGame(JSON.stringify(state))!).ledger[0].journal).toEqual(entries);
  });
  it('records sourced city knowledge without a roll, and does not expose unseen topics', () => {
    const start = planning();
    let state = beginDay(start, plan, () => .5);
    state.active!.encounters = [{ id: '1-p-eiruk', kind: 'patron', actor: 'eiruk', chapter: 0, resolved: false, choice: null, result: null, roll: null, bonus: 0, passed: null }];
    state.active!.visitorRoll = 1;
    state = observeEncounter(state, '1-p-eiruk');
    const entry = journalEntries(state.active!.encounters)[0];
    expect(entry.lore?.title).toBe('安民法师会');
    expect(entry.lore?.source).toContain('thealexandrian.net');
    expect(state.progress.eiruk).toBe(1);
    expect(parseGame(JSON.stringify(state))).toEqual(state);
    expect(entry.text).not.toContain('约在这里见面');
    expect(state.cash).toBe(start.cash - plan.marketing);
    expect(() => observeEncounter(settleDay(state), '1-p-eiruk')).toThrow();
  });
  it('migrates original six-patron saves without dropping cash or past notes', () => {
    const old = nextDay(settleDay(finishInteractions(beginDay(planning(), plan, () => 0))));
    delete old.progress.eiruk; delete old.progress.ulkoria; delete old.progress.rishaal;
    delete old.ledger[0].journal;
    const restored = parseGame(JSON.stringify(old))!;
    expect(restored.cash).toBe(old.cash);
    expect(restored.ledger[0].notes).toEqual(old.ledger[0].notes);
    expect(restored.progress.eiruk).toBe(0);
    expect(restored.progress.ulkoria).toBe(0);
    expect(restored.progress.rishaal).toBe(0);
  });
  it('rejects malformed or unsafe journal sources while accepting real backups', () => {
    let state = beginDay(planning(), plan, () => 0);
    state = observeEncounter(state, state.active!.encounters[0].id);
    expect(parseGame(JSON.stringify(state))).toEqual(state);
    state.active!.encounters[0].entry!.lore = { title: 'bad', text: 'bad', source: 'javascript:alert(1)' };
    expect(parseGame(JSON.stringify(state))).toBeNull();
    const report = settleDay(finishInteractions(beginDay(planning(), plan, () => .5)));
    expect(parseGame(JSON.stringify({ ...report, ledger: [{ ...report.ledger[0], journal: [{ bad: true }] }] }))).toBeNull();
  });
});


describe('expanded faction conversations', () => {
  it('reveals each new patrons topics in order and keeps heard lore through settlement', () => {
    for (const patron of FACTION_PATRONS) {
      let state = planning();
      for (let visit = 0; visit < 4; visit++) {
        state = beginDay(state, { preparation: 'welcome', marketing: 0 }, () => .2);
        state.active!.visitorRoll = 1;
        state.active!.encounters = [{ id: `${state.day}-p-${patron.id}`, kind: 'patron', actor: patron.id, chapter: state.progress[patron.id], resolved: false, choice: null, result: null, roll: null, bonus: 0, passed: null }];
        const encounter = state.active!.encounters[0];
        expect(getStory(encounter).title).toBe((patron.chapters[visit] ?? patron.returnVisit).title);
        state = observeEncounter(state, encounter.id);
        state = settleDay(state);
        const restored = parseGame(JSON.stringify(state))!;
        expect(restored).not.toBeNull();
        expect(restored.ledger.at(-1)!.journal![0].lore).toEqual((patron.chapters[visit] ?? patron.returnVisit).lore);
        expect(restored.progress[patron.id]).toBe(Math.min(visit + 1, 3));
        state = nextDay(restored);
      }
    }
  });
  it('adds all new events to the saved yellow event journal without changing the nightly chance', () => {
    expect(new Set(PATRONS.map(p => p.id)).size).toBe(PATRONS.length);
    expect(new Set(EVENTS.map(e => e.id)).size).toBe(EVENTS.length);
    for (const event of FACTION_EVENTS) {
      let state = beginDay(planning(), plan, () => 0);
      const original = state.active!.encounters[0];
      state.active!.encounters[0] = { ...original, actor: event.id, id: '1-e-' + event.id };
      state = observeEncounter(state, state.active!.encounters[0].id);
      const entry = journalEntries(state.active!.encounters)[0];
      expect(entry.kind).toBe('event');
      expect(entry.title).toBe(event.title);
      expect(entry.lore).toEqual(event.lore);
      expect(parseGame(JSON.stringify(state))).toEqual(state);
    }
  });
  it('upgrades a nine-patron in-progress save without rerolling the current visitors', () => {
    const old = beginDay(planning(), plan, () => 0);
    for (const p of FACTION_PATRONS) delete old.progress[p.id];
    const restored = parseGame(JSON.stringify(old))!;
    expect(restored.active).toEqual(old.active);
    expect(restored.cash).toBe(old.cash);
    for (const p of FACTION_PATRONS) expect(restored.progress[p.id]).toBe(0);
    const bad = structuredClone(restored); bad.progress.yagra = 99;
    expect(parseGame(JSON.stringify(bad))).toBeNull();
  });
});


describe('tavern capital', () => {
  it('starts with 500 gp invested by Renaer without deducting repairs', () => {
    const state = newGame();
    expect(state.cash).toBe(50000);
    expect(state.funding).toEqual([{ day: 1, source: '雷纳的投资', amount: 50000 }]);
    expect(openTavern(state, '酒馆', 'ale').cash).toBe(50000);
  });
  it('records external income once per submission and keeps it outside daily profit', () => {
    const funded = addOtherIncome(planning(), '冒险报酬', 12345);
    expect(funded.cash).toBe(62345);
    expect(funded.totalProfit).toBe(0);
    const report = settleDay(finishInteractions(beginDay(funded, plan, () => .5)));
    const after = addOtherIncome(report, '出售战利品', 550);
    expect(after.cash).toBe(report.cash + 550);
    expect(after.ledger).toEqual(report.ledger);
    expect(after.totalProfit).toBe(report.totalProfit);
    expect(parseGame(JSON.stringify(after))).toEqual(after);
    const next = beginDay(nextDay(after), plan, () => .5);
    expect(next.active!.openingCash).toBe(after.cash);
    expect(() => addOtherIncome(next, '收入', 100)).toThrow();
    for (const amount of [0,-1,1.5,NaN,Infinity,100000001]) expect(() => addOtherIncome(funded,'收入',amount)).toThrow();
    expect(() => addOtherIncome(funded,' ',100)).toThrow();
    const legacy = { ...planning(), cash: 56200 }; delete legacy.funding;
    expect(parseGame(JSON.stringify(legacy))?.cash).toBe(56200);
    expect(parseGame(JSON.stringify({ ...funded, funding: [{ day: 1, source: 'bad', amount: -1 }] }))).toBeNull();
  });
});


it('normalizes legacy Trollskull names in saved names and journal text', () => {
  const old = settleDay(finishInteractions(beginDay(planning(), plan, () => 0)));
  old.name = '巨骷酒馆';
  old.ledger[0].notes = ['巨骷巷来客'];
  old.ledger[0].journal![0].text = '巨骷庄园的旧事';
  const restored = parseGame(JSON.stringify(old))!;
  expect(restored.name).toBe('巨魔颅骨酒馆');
  expect(restored.ledger[0].notes[0]).toBe('巨魔颅骨巷来客');
  expect(restored.ledger[0].journal![0].text).toBe('巨魔颅骨庄园的旧事');
  expect(restored.cash).toBe(old.cash);
});


describe('staff-unlocked styles', () => {
  it('requires the matching employee and does not switch styles on hiring', () => {
    expect(newGame().style).toBe('ale');
    for (const [staff, style] of [['mosp','jazz'],['lillian','tea'],['reynardo','feast']] as const) {
      expect(styleUnlocked(planning(),style)).toBe(false);
      expect(() => openTavern(newGame(),'酒馆',style)).toThrow('雇佣');
      expect(() => changeStyle(planning(),style)).toThrow('雇佣');
      const hired = purchase(planning(),'staff',staff);
      expect(hired.style).toBe('ale');
      expect(styleUnlocked(hired,style)).toBe(true);
      const changed = changeStyle(hired,style);
      expect(changed.cash).toBe(hired.cash);
      expect(parseGame(JSON.stringify(changed))?.style).toBe(style);
      expect(beginDay(changed,plan,()=>.5).active?.style).toBe(style);
      expect(changeStyle(changed,'ale').style).toBe('ale');
    }
    expect(() => changeStyle(purchase(planning(),'staff','mosp'),'tea')).toThrow();
    expect(() => beginDay({...planning(),style:'tea'},plan)).toThrow('尚未解锁');
  });
  it('migrates locked legacy styles without changing an in-progress day or historical receipts', () => {
    const legacy = beginDay(planning(),plan,()=>.5);
    legacy.style = 'jazz'; delete legacy.active!.style;
    const before = dailyTrade(legacy);
    const migrated = parseGame(JSON.stringify(legacy))!;
    expect(migrated.style).toBe('ale');
    expect(migrated.active!.style).toBe('jazz');
    expect(dailyTrade(migrated)).toEqual(before);
    const tomorrow = nextDay(settleDay(finishInteractions(migrated)));
    expect(tomorrow.style).toBe('ale');
    expect(tomorrow.ledger[0].sales).toBeGreaterThan(0);
    const oldMorning = {...planning(),style:'tea' as const};
    expect(parseGame(JSON.stringify(oldMorning))?.style).toBe('ale');
  });
});


describe('staff roles and payroll', () => {
  it('applies group contracts once and combines reception, meals and skill effects', () => {
    const base = planning();
    let hired = purchase(purchase(base, 'staff', 'triplets'), 'staff', 'cook-pair');
    expect(base.cash - hired.cash).toBe(6500);
    expect(() => purchase(hired, 'staff', 'triplets')).toThrow();
    const baseline = dailyTrade(beginDay(base, plan, () => .5));
    const trade = dailyTrade(beginDay(hired, plan, () => .5));
    expect(trade.guests - baseline.guests).toBe(9);
    expect(trade.orders!.supplement - baseline.orders!.supplement).toBe(7);
    expect(trade.wages).toBe(230);
    expect(trade.payroll).toHaveLength(2);
    expect(skillBonus(hired, 'social') - skillBonus(base, 'social')).toBe(2);
    expect(skillBonus(hired, 'craft') - skillBonus(base, 'craft')).toBe(1);
  });
  it('preserves the slow chef and low-cost poor cook tradeoffs', () => {
    const base = planning();
    const baseline = dailyTrade(beginDay(base, plan, () => .5));
    const fine = dailyTrade(beginDay(purchase(base, 'staff', 'reynardo'), plan, () => .5));
    expect(fine.guests - baseline.guests).toBe(-3);
    expect(fine.orders!.supplement - baseline.orders!.supplement).toBe(10);
    const cheap = purchase(base, 'staff', 'turgattan');
    const trade = dailyTrade(beginDay(cheap, plan, () => .5));
    expect(trade.wages).toBe(20);
    expect(trade.orders!.supplement - baseline.orders!.supplement).toBe(-5);
    expect(skillBonus(cheap, 'craft') - skillBonus(base, 'craft')).toBe(-1);
  });
  it('limits dismissal to mornings, relocks styles and keeps historical payroll', () => {
    const hired = changeStyle(purchase(purchase(planning(), 'staff', 'mosp'), 'staff', 'patric'), 'jazz');
    expect(dismissStaff(hired, 'patric').style).toBe('jazz');
    const running = beginDay(hired, plan, () => .5);
    expect(() => dismissStaff(running, 'mosp')).toThrow();
    let observed = running;
    for (const e of running.active!.encounters) observed = observeEncounter(observed, e.id);
    const settled = settleDay(observed);
    expect(settled.ledger[0].wages).toBe(75);
    expect(settled.ledger[0].payroll).toHaveLength(2);
    expect(() => dismissStaff(settled, 'mosp')).toThrow();
    const dismissed = dismissStaff(nextDay(settled), 'mosp');
    expect(dismissed.style).toBe('ale');
    expect(dismissed.cash).toBe(settled.cash);
    expect(dailyTrade(beginDay(dismissed, plan, () => .5)).wages).toBe(25);
    expect(dismissed.ledger).toEqual(settled.ledger);
    expect(parseGame(JSON.stringify(dismissed))).toEqual(dismissed);
    expect(purchase(dismissed, 'staff', 'mosp').cash).toBe(dismissed.cash - 1750);
    expect(() => dismissStaff(dismissed, 'mosp')).toThrow();
    const corrupt = structuredClone(dismissed);
    corrupt.ledger[0].payroll![0].wage += 1;
    expect(parseGame(JSON.stringify(corrupt))).toBeNull();
  });
});
