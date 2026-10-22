import { DEFAULT_OPENING_DAY } from './date';
import { EVERYDAY_EVENTS, everydayPool } from './everyday-content';
import { STAFF_STORIES } from './staff-content';
import { DRINKS, orderTotals, validOrders, type DrinkDice, type Orders } from './drinks';
import { FACTION_PATRONS } from './faction-content';
import { CITY_SOURCES } from './city-patrons';
import { EVENTS, PATRONS, PREPARATIONS, STAFF, STYLES, UPGRADES, type Choice, type Lore, type Skill, type Story } from './catalog';

export const SAVE_KEY = 'dm-tools:tavern:v1';
export const OPENING_COST = 93800;
export type Plan = { preparation: typeof PREPARATIONS[number]['id']; marketing: 0 | 300 | 600 };
export type EncounterKind = 'patron' | 'event' | 'staff' | 'staff-event' | 'windfall' | 'everyday';
export const isSpecial = (kind: EncounterKind) => kind === 'event' || kind === 'staff-event' || kind === 'windfall';
export const encounterLabel = (kind: EncounterKind) => kind === 'everyday' ? '酒馆日常' : kind === 'staff' ? '雇员交谈' : kind === 'staff-event' ? '雇员事件' : isSpecial(kind) ? '特殊事件' : '顾客来访';
export type JournalEntry = { kind: EncounterKind; name: string; title: string; text: string; action: string; result: string; lore?: Lore };
export type Encounter = { id: string; kind: EncounterKind; actor: string; chapter: number; resolved: boolean; choice: string | null; result: string | null; roll: number | null; bonus: number; passed: boolean | null; resolvedOrder?: number; entry?: JournalEntry };
export type TradingDay = { cashAdjustment?: number; calendarDay?: number; patronDie?: 3; windfallRoll?: number; drinkDice?: DrinkDice[]; style?: GameState['style']; openingCash: number; marketing: number; preparation: Plan['preparation']; weather: string; weatherGuests: number; visitorRoll: number; eventRoll: number; trafficRolls: [number, number]; encounters: Encounter[]; extraGuests: number; extraTicket: number; storyIncome: number; storyCost: number };
export type Payroll = { name: string; role: string; wage: number };
export type Settlement = { cashAdjustment?: number; calendarDay?: number; dailyNet?: number; payroll?: Payroll[]; orders?: Orders; day: number; openingCash: number; guests: number; ticket: number; sales: number; ingredients: number; upkeep: number; wages: number; marketing: number; storyIncome: number; storyCost: number; net: number; closingCash: number; newDebt: number; debt: number; reputation: number; weather: string; notes: string[]; journal?: JournalEntry[] };
export type FundingEntry = { day: number; source: string; amount: number };
export type GameState = { calendarAdjustment?: number; calendarSkippedDays?: number; calendarStartDay?: number; funding?: FundingEntry[]; version: 1; name: string; style: typeof STYLES[number]['id']; phase: 'setup' | 'planning' | 'running' | 'report' | 'finished'; day: number; cash: number; debt: number; reputation: number; staff: string[]; upgrades: string[]; progress: Record<string, number>; totalProfit: number; freePlay: boolean; active: TradingDay | null; ledger: Settlement[] };
export type Random = () => number;
export const money = (cp: number) => (cp / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
export const die = (faces: number, random: Random = Math.random) => clamp(Math.floor(random() * faces) + 1, 1, faces);
export function newGame(): GameState {
  return { version: 1, name: '巨魔颅骨酒馆', style: 'ale', phase: 'setup', day: 1, cash: 50000, funding: [{ day: 1, source: '雷纳的投资', amount: 50000 }], debt: 0, reputation: 20, staff: [], upgrades: [], progress: Object.fromEntries(PATRONS.map(p => [p.id, 0])), totalProfit: 0, freePlay: false, active: null, ledger: [] };
}
function requirePhase(state: GameState, phase: GameState['phase']) { if (state.phase !== phase) throw new Error('这个阶段不能执行该操作。'); }
export function styleUnlocked(state: Pick<GameState, 'staff'>, style: GameState['style']): boolean {
  const option = STYLES.find(s => s.id === style);
  return !!option && (!option.requiredStaff || state.staff.includes(option.requiredStaff));
}
export function openTavern(state: GameState, name: string, style: GameState['style']): GameState {
  requirePhase(state, 'setup');
  if (!styleUnlocked(state, style)) throw new Error('请先雇佣对应雇员以解锁经营风格。');
  return { ...state, name: name.trim().slice(0, 40) || '巨魔颅骨酒馆', style, cash: state.cash, phase: 'planning' };
}
export function returnToSetup(state: GameState): GameState {
  requirePhase(state, 'planning');
  return { ...state, phase: 'setup' };
}
/** Balance corrections are capital changes, not operating profit. */
export function setAvailableCash(state: GameState, amount: number): GameState {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000000) throw new Error('金币须在0至1,000,000 gp之间，最多两位小数。');
  const adjustment = (state.active?.cashAdjustment ?? 0) + amount - state.cash;
  if (state.active && Math.abs(adjustment) > 100000000) throw new Error('当日余额调整超出支持范围。');
  return { ...state, cash: amount, active: state.active ? { ...state.active, cashAdjustment: adjustment } : null };
}
/** External income is capital, not tavern operating profit. Register outside service. */
export function addOtherIncome(state: GameState, source: string, amount: number): GameState {
  if (!['setup', 'planning', 'report'].includes(state.phase)) throw new Error('请在营业前或打烊后登记其他收益。');
  if (!source.trim() || source.trim().length > 80) throw new Error('请填写80字以内的收入来源。');
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 100000000 || state.cash + amount > 100000000) throw new Error('请输入有效的正数金额，余额不得超过1,000,000 gp。');
  const funding = state.funding ?? [];
  if (funding.length >= 1000) throw new Error('资金记录已达到1000条上限。');
  return { ...state, cash: state.cash + amount, funding: [...funding, { day: state.day, source: source.trim(), amount }] };
}
export function changeStyle(state: GameState, style: GameState['style']): GameState {
  requirePhase(state, 'planning');
  if (!styleUnlocked(state, style)) throw new Error('请先雇佣对应雇员以解锁经营风格。');
  return { ...state, style };
}
export function purchase(state: GameState, kind: 'staff' | 'upgrade', id: string): GameState {
  requirePhase(state, 'planning');
  const item = (kind === 'staff' ? STAFF : UPGRADES).find(i => i.id === id);
  const owned = kind === 'staff' ? state.staff : state.upgrades;
  if (!item || owned.includes(id)) throw new Error('已经拥有或无法购买这个项目。');
  if (state.cash < item.cost) throw new Error('金币不足。');
  return { ...state, cash: state.cash - item.cost, [kind === 'staff' ? 'staff' : 'upgrades']: [...owned, id] };
}
export function dismissStaff(state: GameState, id: string): GameState {
  requirePhase(state, 'planning');
  if (!state.staff.includes(id)) throw new Error('该雇员尚未加入。');
  const next = { ...state, staff: state.staff.filter(s => s !== id) };
  return { ...next, style: styleUnlocked(next, next.style) ? next.style : 'ale' };
}
export function repayDebt(state: GameState): GameState {
  requirePhase(state, 'planning');
  if (!state.debt || !state.cash) throw new Error('暂无可偿还的欠费。');
  const amount = Math.min(state.debt, state.cash);
  return { ...state, cash: state.cash - amount, debt: state.debt - amount };
}
export function beginDay(state: GameState, plan: Plan, random: Random = Math.random): GameState {
  requirePhase(state, 'planning');
  if (!styleUnlocked(state, state.style)) throw new Error('当前经营风格尚未解锁。');
  if (!PREPARATIONS.some(p => p.id === plan.preparation) || ![0, 300, 600].includes(plan.marketing)) throw new Error('经营计划无效。');
  if (state.cash < plan.marketing) throw new Error('金币不足以支付宣传费用。');
  const visitorRoll = die(3, random), eventRoll = die(6, random), weatherRoll = die(6, random);
  const trafficRolls: [number, number] = [die(8, random), die(8, random)];
  const pool = [...PATRONS];
  const encounters: Encounter[] = [];
  for (let i = 0; i < visitorRoll; i++) {
    const [patron] = pool.splice(die(pool.length, random) - 1, 1);
    encounters.push({ id: `${state.day}-p-${patron.id}`, kind: 'patron', actor: patron.id, chapter: state.progress[patron.id] ?? 0, resolved: false, choice: null, result: null, roll: null, bonus: 0, passed: null });
  }
  if (eventRoll === 1) {
    const event = EVENTS[die(EVENTS.length, random) - 1];
    encounters.unshift({ id: `${state.day}-e-${event.id}`, kind: 'event', actor: event.id, chapter: 0, resolved: false, choice: null, result: null, roll: null, bonus: 0, passed: null });
  }
  const drinkDice: DrinkDice[] = Array.from({ length: 80 }, () => [die(20, random), die(6, random)]);
  // Employee scenes have their own slots and never consume patron/order slots.
  if (state.staff.length) {
    const actor = state.staff[die(state.staff.length, random) - 1];
    encounters.push({ id: `${state.day}-s-${actor}`, kind: 'staff', actor, chapter: state.progress[`staff:${actor}`] ?? 0, resolved: false, choice: null, result: null, roll: null, bonus: 0, passed: null });
    if (die(6, random) === 1) {
      const actor = state.staff[die(state.staff.length, random) - 1];
      encounters.push({ id: `${state.day}-se-${actor}`, kind: 'staff-event', actor, chapter: 0, resolved: false, choice: null, result: null, roll: null, bonus: 0, passed: null });
    }
  }
  const windfallRoll = die(100, random);
  if (windfallRoll === 1) encounters.push({ id: `${state.day}-windfall`, kind: 'windfall', actor: 'generous-customer', chapter: 0, resolved: false, choice: null, result: null, roll: null, bonus: 0, passed: null });
  for (const group of ['customer', 'operation'] as const) {
    const options = everydayPool(group);
    const item = options[die(options.length, random) - 1];
    encounters.push({ id: `${state.day}-daily-${item.id}`, kind: 'everyday', actor: item.id, chapter: 0, resolved: false, choice: null, result: null, roll: null, bonus: 0, passed: null });
  }
  const active: TradingDay = { calendarDay: currentCalendarDay(state), patronDie: 3, windfallRoll, style: state.style, drinkDice, openingCash: state.cash, marketing: plan.marketing, preparation: plan.preparation, weather: weatherRoll <= 2 ? '细雨过巷' : weatherRoll === 6 ? '街市热闹' : '晴朗的一天', weatherGuests: weatherRoll <= 2 ? -4 : weatherRoll === 6 ? 5 : 0, visitorRoll, eventRoll, trafficRolls, encounters, extraGuests: 0, extraTicket: 0, storyIncome: 0, storyCost: 0 };
  return { ...state, phase: 'running', cash: state.cash - plan.marketing, active };
}
export function getStory(encounter: Encounter): Story & { name: string; role: string; color: string; initial: string } {
  if (encounter.kind === 'everyday') {
    const event = EVERYDAY_EVENTS.find(e => e.id === encounter.actor);
    if (!event) throw new Error('日常事件不存在。');
    return { ...event, role: event.group === 'customer' ? '普通顾客' : '日常经营', initial: event.group === 'customer' ? '客' : '店', color: '#8b8373', choices: [{ id: 'record', label: '记入日志', cost: 0, success: {}, successText: '已记录。' }] };
  }
  if (encounter.kind === 'windfall') return {
    name: '阔绰的顾客', role: '偶然来客', initial: '金', color: '#ba943f',
    title: '阔绰的顾客', text: '一位衣着考究的客人结清酒钱，又将十枚金币留在吧台上。等服务生转过身，客人已经走进巷口的人群。',
    choices: [{ id: 'record', label: '记入账本', cost: 0, success: {}, successText: '额外收入 10.00 gp 已记入今日账目。' }],
  };
  if (encounter.kind === 'staff' || encounter.kind === 'staff-event') {
    const staff = STAFF.find(s => s.id === encounter.actor);
    const content = STAFF_STORIES[encounter.actor];
    if (!staff || !content) throw new Error('雇员记录不存在。');
    const story = encounter.kind === 'staff-event' ? content.event : content.talks[Math.min(encounter.chapter, content.talks.length - 1)];
    return { ...story, name: staff.name, role: staff.role, color: '#718c64', initial: staff.job[0] };
  }
  if (encounter.kind === 'event') {
    const event = EVENTS.find(e => e.id === encounter.actor);
    if (!event) throw new Error('事件不存在。');
    return { ...event, name: '今晚的突发事件' };
  }
  const patron = PATRONS.find(p => p.id === encounter.actor);
  if (!patron) throw new Error('访客不存在。');
  return { ...patron, ...(patron.chapters[encounter.chapter] ?? patron.returnVisit) };
}
export function skillBonus(state: GameState, skill: Skill): number {
  let bonus = 2 + Math.floor(state.reputation / 25);
  for (const id of state.staff) { const person = STAFF.find(s => s.id === id); if (person?.skill === skill) bonus += person.bonus; }
  if (skill === 'craft') bonus += (state.upgrades.includes('kitchen') ? 2 : 0) + (state.active?.preparation === 'special' ? 2 : 0);
  if (skill === 'watch') bonus += (state.upgrades.includes('locks') ? 3 : 0) + (state.active?.preparation === 'watch' ? 3 : 0);
  if (skill === 'social' && state.upgrades.includes('stage')) bonus += 1;
  return bonus;
}
export function chance(state: GameState, choice: Choice): number { return choice.skill && choice.dc ? clamp((21 + skillBonus(state, choice.skill) - choice.dc) * 5, 0, 100) : 100; }
function advanceProgress(state: GameState, e: Encounter): GameState['progress'] {
  const key = e.kind === 'patron' ? e.actor : e.kind === 'staff' ? `staff:${e.actor}` : null;
  return key ? { ...state.progress, [key]: Math.min(3, e.chapter + 1) } : state.progress;
}
export function resolveEncounter(state: GameState, encounterId: string, choiceId: string, random: Random = Math.random): GameState {
  requirePhase(state, 'running');
  const day = state.active;
  const encounter = day?.encounters.find(e => e.id === encounterId);
  if (!day || !encounter || encounter.resolved) throw new Error('这段互动已经处理过了。');
  if (encounter.kind === 'everyday') {
    if (choiceId !== 'record') throw new Error('选项无效。');
    return observeEncounter(state, encounterId);
  }
  const scene = getStory(encounter);
  const choice = scene.choices.find(c => c.id === choiceId);
  if (!choice || state.cash < choice.cost) throw new Error('金币不足或选项无效。');
  const roll = choice.skill ? die(20, random) : null;
  const bonus = choice.skill ? skillBonus(state, choice.skill) : 0;
  const passed = roll === null || roll + bonus >= (choice.dc ?? 0);
  const effect = passed ? choice.success : choice.failure ?? {};
  const income = (effect.income ?? 0) + (encounter.kind === 'windfall' ? 1000 : 0);
  return { ...state, cash: state.cash - choice.cost + income, reputation: clamp(state.reputation + (effect.reputation ?? 0), 0, 100), progress: advanceProgress(state, encounter), active: { ...day, extraGuests: day.extraGuests + (effect.guests ?? 0), extraTicket: day.extraTicket + (effect.ticket ?? 0), storyIncome: day.storyIncome + income, storyCost: day.storyCost + choice.cost, encounters: day.encounters.map(e => e.id === encounterId ? { ...e, resolved: true, entry: { kind: e.kind, name: scene.name, title: scene.title, text: scene.text, action: choice.label, result: passed ? choice.successText : choice.failureText ?? '这次没有成功。', ...(scene.lore ? { lore: scene.lore } : {}) }, choice: choiceId, result: passed ? choice.successText : choice.failureText ?? '这次没有成功。', roll, bonus, passed, resolvedOrder: day.encounters.filter(x => x.resolved).length + 1 } : e) } };
}
/** Record a scene without accepting a request or making a rewarded choice. */
export function observeEncounter(state: GameState, id: string): GameState {
  requirePhase(state, 'running');
  const day = state.active;
  const e = day?.encounters.find(e => e.id === id);
  if (!day || !e || e.resolved) throw new Error('这条记录已经处理过了。');
  const scene = getStory(e);
  const delta = e.kind === 'everyday' ? EVERYDAY_EVENTS.find(item => item.id === e.actor)!.delta : 0;
  const result = e.kind === 'everyday' ? `当日净收益 ${delta >= 0 ? '+' : '−'}${money(Math.abs(delta))} gp，打烊时结算。` : e.kind === 'windfall' ? '额外收入 10.00 gp 已记入今日账目。' : isSpecial(e.kind) ? '记录了现场情况，未另作处置。' : e.kind === 'staff' ? '记下了这段日常，大家继续手头的工作。' : '客人照常用餐，未进一步交谈。';
  const entry: JournalEntry = { kind: e.kind, name: scene.name, title: scene.title, text: scene.text, action: '继续营业', result, ...(scene.lore ? { lore: scene.lore } : {}) };
  return { ...state, cash: state.cash + (e.kind === 'windfall' ? 1000 : 0), progress: advanceProgress(state, e),
    active: { ...day, storyIncome: day.storyIncome + (e.kind === 'windfall' ? 1000 : 0), encounters: day.encounters.map(x => x.id === id ? { ...x, resolved: true, choice: 'observe', result, roll: null, bonus: 0, passed: true, entry, resolvedOrder: day.encounters.filter(x => x.resolved).length + 1 } : x) } };
}
export function journalEntries(encounters: Encounter[]): JournalEntry[] {
  return encounters.filter(e => e.resolved).sort((a,b) => (a.resolvedOrder ?? 0) - (b.resolvedOrder ?? 0)).map(e => e.entry ?? {
    kind: e.kind, name: getStory(e).name, title: '旧版记录', text: '', action: '', result: e.result ?? '',
  });
}
export function dailyTrade(state: GameState): { guests: number; ticket: number; sales: number; ingredients: number; upkeep: number; wages: number; orders?: Orders; payroll: Payroll[] } {
  if (!state.active) throw new Error('今天尚未开始营业。');
  const day = state.active;
  const style = STYLES.find(s => s.id === (day.style ?? state.style))!;
  const crew = STAFF.filter(s => state.staff.includes(s.id));
  const improvements = UPGRADES.filter(s => state.upgrades.includes(s.id));
  const guests = clamp(18 + day.trafficRolls[0] + day.trafficRolls[1] + style.guests + Math.floor(state.reputation / 5) + day.weatherGuests + (day.preparation === 'welcome' ? 4 : 0) + day.marketing / 300 * 8 + day.extraGuests + crew.reduce((n, s) => n + s.guests, 0) + improvements.reduce((n, s) => n + s.guests, 0) - Math.floor(state.debt / 1000), 8, 80);
  const ticket = clamp(style.ticket + day.extraTicket + (day.preparation === 'special' ? 6 : 0) + crew.reduce((n, s) => n + s.ticket, 0) + improvements.reduce((n, s) => n + s.ticket, 0), 35, 120);
  const payroll = crew.map(s => ({ name: s.name, role: s.role, wage: s.wage }));
  const wages = crew.reduce((n, s) => n + s.wage, 0);
  // Existing in-progress saves retain the old pricing through this settlement.
  if (!day.drinkDice) return { guests, ticket, sales: guests * ticket, ingredients: guests * 18, upkeep: 600, wages, payroll };
  const patrons = day.encounters.filter(e => e.kind === 'patron');
  const orders: Orders = { dice: day.drinkDice.slice(0, guests), menu: DRINKS.map(d => ({ ...d })), names: patrons.map(e => getStory(e).name), nonAlcoholic: patrons.flatMap((e,i) => e.actor === 'urchins' ? [i] : []), supplement: Math.max(0, ticket - 35) };
  const totals = orderTotals(orders);
  return { guests, ticket: Math.round(totals.sales / guests), ...totals, upkeep: 600, wages, orders, payroll };
}
export function everydayNet(state: GameState): number {
  return (state.active?.encounters ?? []).filter(e => e.kind === 'everyday' && e.resolved).reduce((sum, e) => sum + (EVERYDAY_EVENTS.find(item => item.id === e.actor)?.delta ?? 0), 0);
}
export function settleDay(state: GameState): GameState {
  requirePhase(state, 'running');
  const day = state.active;
  if (!day || day.encounters.some(e => !e.resolved)) throw new Error('先处理完今天的访客与事件。');
  const trade = dailyTrade(state);
  const dailyNet = everydayNet(state);
  const net = dailyNet + trade.sales + day.storyIncome - trade.ingredients - trade.upkeep - trade.wages - day.marketing - day.storyCost;
  const available = day.openingCash + (day.cashAdjustment ?? 0) + net;
  const newDebt = Math.max(0, -available), closingCash = Math.max(0, available), debt = state.debt + newDebt;
  const reputation = clamp(state.reputation + (net >= 0 ? 1 : -1), 0, 100);
  const report: Settlement = { cashAdjustment: day.cashAdjustment ?? 0, calendarDay: day.calendarDay ?? currentCalendarDay(state), dailyNet, day: state.day, openingCash: day.openingCash, ...trade, marketing: day.marketing, storyIncome: day.storyIncome, storyCost: day.storyCost, net, closingCash, newDebt, debt, reputation, weather: day.weather, notes: journalEntries(day.encounters).map(e => `${e.name}：${e.result}`), journal: journalEntries(day.encounters) };
  return { ...state, phase: 'report', active: null, cash: closingCash, debt, reputation, totalProfit: state.totalProfit + net, ledger: [...state.ledger.slice(-59), report] };
}
export function currentCalendarDay(state: GameState): number {
  return (state.calendarStartDay ?? DEFAULT_OPENING_DAY) + calendarElapsedDay(state) - 1;
}
export function calendarElapsedDay(state: GameState): number {
  return state.day + (state.calendarSkippedDays ?? 0) + (state.calendarAdjustment ?? 0);
}
export function setCalendarDate(state: GameState, absoluteDay: number): GameState {
  if (!Number.isSafeInteger(absoluteDay) || absoluteDay < 0 || absoluteDay > 500000) throw new Error('日期超出支持范围。');
  return { ...state, calendarAdjustment: absoluteDay - (state.calendarStartDay ?? DEFAULT_OPENING_DAY) - state.day + 1 - (state.calendarSkippedDays ?? 0) };
}
export function advanceCalendarDay(state: GameState): GameState {
  if (!['setup', 'planning'].includes(state.phase)) throw new Error('请先完成当日营业和结算，再推进休业日期。');
  const skipped = state.calendarSkippedDays ?? 0;
  if (skipped >= 99999) throw new Error('休业天数已达到存档上限。');
  return { ...state, calendarSkippedDays: skipped + 1 };
}
export function nextDay(state: GameState): GameState {
  requirePhase(state, 'report');
  return { ...state, phase: state.debt >= 15000 || (!state.freePlay && state.day >= 30) ? 'finished' : 'planning', day: state.debt >= 15000 || (!state.freePlay && state.day >= 30) ? state.day : state.day + 1 };
}
export function continuePlaying(state: GameState): GameState {
  requirePhase(state, 'finished');
  if (state.debt >= 15000) throw new Error('酒馆已因欠费停业，请重新开业。');
  return { ...state, freePlay: true, phase: 'planning', day: state.day + 1 };
}

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: unknown, min = 0, max = 100000000): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const text = (v: unknown, length = 1000): v is string => typeof v === 'string' && v.length <= length;
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v);
function validEntry(v: unknown): v is JournalEntry {
  if (!object(v) || !oneOf(v.kind, ['patron', 'event', 'staff', 'staff-event', 'windfall', 'everyday']) || !['name','title','text','action','result'].every(k => text(v[k]))) return false;
  if (v.lore !== undefined && (!object(v.lore) || !text(v.lore.title, 100) || !text(v.lore.text) || !oneOf(v.lore.source, Object.values(CITY_SOURCES)))) return false;
  return true;
}
function validEncounter(v: unknown): v is Encounter {
  if (object(v) && v.entry !== undefined && (!v.resolved || !validEntry(v.entry))) return false;
  if (!object(v) || !text(v.id, 60) || typeof v.resolved !== 'boolean' || !integer(v.chapter, 0, 3) || !integer(v.bonus, 0, 30)) return false;
  if (!oneOf(v.kind, ['patron', 'event', 'staff', 'staff-event', 'windfall', 'everyday']) || !(v.kind === 'windfall' ? v.actor === 'generous-customer' : (v.kind === 'patron' ? PATRONS : v.kind === 'event' ? EVENTS : v.kind === 'everyday' ? EVERYDAY_EVENTS : STAFF).some(e => e.id === v.actor))) return false;
  if (v.choice !== null && !text(v.choice, 40)) return false;
  if (v.result !== null && !text(v.result)) return false;
  if (v.roll !== null && !integer(v.roll, 1, 20)) return false;
  if (v.passed !== null && typeof v.passed !== 'boolean') return false;
  if (v.resolvedOrder !== undefined && (!v.resolved || !integer(v.resolvedOrder, 1, 12))) return false;
  if (v.resolved && (v.result === null || v.choice === null || v.passed === null)) return false;
  if (!v.resolved && (v.choice !== null || v.result !== null || v.roll !== null || v.passed !== null)) return false;
  return true;
}
function validReport(v: unknown): v is Settlement {
  if (!object(v) || !integer(v.day, 1, 99999) || !text(v.weather, 30) || !Array.isArray(v.notes) || v.notes.length > 12 || !v.notes.every(n => text(n))) return false;
  if (v.cashAdjustment !== undefined && !integer(v.cashAdjustment, -100000000, 100000000)) return false;
  if (v.calendarDay !== undefined && !integer(v.calendarDay, 0, 2000000)) return false;
  if (v.journal !== undefined && (!Array.isArray(v.journal) || v.journal.length > 12 || !v.journal.every(validEntry))) return false;
  if (v.dailyNet !== undefined && !integer(v.dailyNet, -200, 200)) return false;
  if (v.payroll !== undefined && (!Array.isArray(v.payroll) || v.payroll.length > STAFF.length || !v.payroll.every(p => object(p) && text(p.name, 80) && text(p.role, 80) && integer(p.wage)) || v.payroll.reduce((sum, p) => sum + p.wage, 0) !== v.wages)) return false;
  if (v.orders !== undefined && (!validOrders(v.orders) || v.orders.dice.length !== v.guests || orderTotals(v.orders).sales !== v.sales || orderTotals(v.orders).ingredients !== v.ingredients)) return false;
  if (!integer(v.net, -100000000) || !integer(v.reputation, 0, 100)) return false;
  return ['openingCash','guests','ticket','sales','ingredients','upkeep','wages','marketing','storyIncome','storyCost','closingCash','newDebt','debt'].every(k => integer(v[k]));
}
/** A malformed or unsupported save never reaches the game engine. */
export function parseGame(raw: string | null): GameState | null {
  if (!raw || raw.length > 500000) return null;
  try {
    const v: unknown = JSON.parse(raw, (_key, value: unknown) => typeof value === 'string' ? value.replaceAll('巨骷', '巨魔颅骨') : value);
    if (!object(v) || v.version !== 1 || !text(v.name, 40) || !v.name.trim() || !STYLES.some(s => s.id === v.style) || !oneOf(v.phase, ['setup','planning','running','report','finished'])) return null;
    if (v.calendarAdjustment !== undefined && !integer(v.calendarAdjustment, -1000000, 1000000)) return null;
    if (v.calendarSkippedDays !== undefined && !integer(v.calendarSkippedDays, 0, 99999)) return null;
    if (v.calendarStartDay !== undefined && !integer(v.calendarStartDay, 0, 365)) return null;
    if (!integer(v.day, 1, 99999) || !integer(v.cash) || !integer(v.debt) || !integer(v.reputation, 0, 100) || !integer(v.totalProfit, -100000000) || typeof v.freePlay !== 'boolean') return null;
    if ((Number(v.calendarStartDay ?? DEFAULT_OPENING_DAY) + Number(v.day) - 1 + Number(v.calendarSkippedDays ?? 0) + Number(v.calendarAdjustment ?? 0)) < 0) return null;
    if (!Array.isArray(v.staff) || new Set(v.staff).size !== v.staff.length || !v.staff.every(id => STAFF.some(s => s.id === id))) return null;
    if (!Array.isArray(v.upgrades) || new Set(v.upgrades).size !== v.upgrades.length || !v.upgrades.every(id => UPGRADES.some(s => s.id === id))) return null;
    if (object(v.progress)) { for (const id of ['eiruk', 'ulkoria', 'rishaal', ...FACTION_PATRONS.map(p => p.id)]) { if (!(id in v.progress)) v.progress[id] = 0; } }
    if (!object(v.progress) || !PATRONS.every(p => integer((v.progress as Record<string, unknown>)[p.id], 0, 3))) return null;
    if (STAFF.some(s => (v.progress as Record<string, unknown>)[`staff:${s.id}`] !== undefined && !integer((v.progress as Record<string, unknown>)[`staff:${s.id}`], 0, 3))) return null;
    if (v.funding !== undefined && (!Array.isArray(v.funding) || v.funding.length > 1000 || !v.funding.every(e => object(e) && integer(e.day, 1, 99999) && text(e.source, 80) && e.source.trim() && integer(e.amount, 1)))) return null;
    if (!Array.isArray(v.ledger) || v.ledger.length > 60 || !v.ledger.every(validReport)) return null;
    if (v.phase === 'report' || v.phase === 'finished') { if (!v.ledger.length || v.ledger.at(-1)?.day !== v.day) return null; }
    if (v.phase === 'running') {
      const d = v.active;
      if (!object(d) || !oneOf(d.preparation, PREPARATIONS.map(p => p.id)) || !oneOf(d.marketing, [0,300,600]) || !text(d.weather, 30)) return null;
      if (!integer(d.openingCash) || !integer(d.storyIncome) || !integer(d.storyCost) || !integer(d.extraGuests, -100, 200) || !integer(d.extraTicket, -100, 200) || !integer(d.weatherGuests, -4, 5) || !integer(d.visitorRoll, 1, 6) || !integer(d.eventRoll, 1, 6)) return null;
      if (d.cashAdjustment !== undefined && !integer(d.cashAdjustment, -100000000, 100000000)) return null;
      if (d.calendarDay !== undefined && !integer(d.calendarDay, 0, 2000000)) return null;
      if (d.style !== undefined && !STYLES.some(s => s.id === d.style)) return null;
      if (d.drinkDice !== undefined && (!Array.isArray(d.drinkDice) || d.drinkDice.length !== 80 || !d.drinkDice.every(r => Array.isArray(r) && r.length === 2 && integer(r[0],1,20) && integer(r[1],1,6)))) return null;
      if (!Array.isArray(d.trafficRolls) || d.trafficRolls.length !== 2 || !d.trafficRolls.every(n => integer(n, 1, 8))) return null;
      if (!Array.isArray(d.encounters) || d.encounters.length > 12 || !d.encounters.every(validEncounter) || new Set(d.encounters.map(e => e.id)).size !== d.encounters.length) return null;
      const encounters = d.encounters as Encounter[];
      if (d.patronDie !== undefined && (d.patronDie !== 3 || d.visitorRoll > 3)) return null;
      if (d.windfallRoll !== undefined && !integer(d.windfallRoll, 1, 100)) return null;
      if (encounters.filter(e => e.kind === 'windfall').length !== (d.windfallRoll === 1 ? 1 : 0)) return null;
      const everyday = encounters.filter(e => e.kind === 'everyday');
      if (everyday.length > 2 || new Set(everyday.map(e => EVERYDAY_EVENTS.find(item => item.id === e.actor)!.group)).size !== everyday.length) return null;
      const employeeScenes = encounters.filter(e => e.kind === 'staff' || e.kind === 'staff-event');
      if (employeeScenes.some(e => !(v.staff as string[]).includes(e.actor)) || encounters.filter(e => e.kind === 'staff').length > 1 || encounters.filter(e => e.kind === 'staff-event').length > 1) return null;
      if (encounters.filter(e => e.kind === 'patron').length !== d.visitorRoll) return null;
      if (encounters.filter(e => e.kind === 'event').length !== (d.eventRoll === 1 ? 1 : 0) || new Set(encounters.filter(e => e.kind === 'patron').map(e => e.actor)).size !== d.visitorRoll) return null;
      if (v.cash !== d.openingCash + Number(d.cashAdjustment ?? 0) - (d.marketing as number) - d.storyCost + d.storyIncome) return null;
    } else if (v.active !== null) return null;
    const saved = v as unknown as GameState;
    if (saved.active && saved.active.calendarDay === undefined) saved.active.calendarDay = currentCalendarDay(saved);
    if (!styleUnlocked(saved, saved.style)) {
      // Preserve the old day's pricing, but require staff from the next morning.
      if (saved.active && !saved.active.style) saved.active.style = saved.style;
      saved.style = 'ale';
    }
    return saved;
  } catch { return null; }
}
