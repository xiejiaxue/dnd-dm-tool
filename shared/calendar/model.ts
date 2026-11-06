export type CalendarEvent = { flavor?: { speaker: string; text: string; background: string }; id: string; title: string; day: number; minute: number | null; kind: '剧情' | '节庆' | '派系' | '期限' | '自定义'; status: '待处理' | '已完成' | '已取消'; public: boolean; detail: string; source: string; condition: string };
export type CalendarSave = { version: 1; id: string; name: string; now: number; events: CalendarEvent[]; history: { from: number; to: number }[] };
export const MONTHS = ['严冬之月 Hammer', '寒冷之月 Alturiak', '彻斯 Ches', '塔斯 Tarsakh', '溶雪之月 Mirtul', '花开之月 Kythorn', '炽火之月 Flamerule', '艳阳之月 Eleasis', '衰败之月 Eleint', '落叶之月 Marpenoth', '腐叶之月 Uktar', '岁末 Nightal'];
// 1492 DR: intercalary holidays are separate dates, never day 31 of a month.
export const DAYS = MONTHS.flatMap((name, m) => {
  const dates = Array.from({ length: 30 }, (_, i) => ({ key: `${m + 1}-${i + 1}`, month: m + 1, day: i + 1, label: `${name.split(' ')[0]} ${i + 1}日` }));
  const holidays: Record<number, string[]> = { 1: ['仲冬节'], 4: ['绿草节'], 7: ['仲夏节', '盾会'], 9: ['丰收节'], 11: ['月亮庆典'] };
  return [...dates, ...(holidays[m + 1] ?? []).map((label, i) => ({ key: `holiday-${m + 1}-${i}`, month: m + 1, day: 0, label }))];
});
export const dayIndex = (month: number, day: number) => DAYS.findIndex(d => d.key === `${month}-${day}`);
export const LAST_MINUTE = DAYS.length * 1440 - 1;
export function newCalendar(name = '深水城主团', events: CalendarEvent[] = []): CalendarSave { return { version: 1, id: crypto.randomUUID(), name, now: dayIndex(3, 1) * 1440 + 9 * 60, events: structuredClone(events), history: [] }; }
export function advance(save: CalendarSave, to: number): CalendarSave {
  if (!Number.isInteger(to) || to < 0 || to > LAST_MINUTE || to === save.now) return save;
  return { ...save, now: to, history: [...save.history, { from: save.now, to }].slice(-50) };
}
export function undoAdvance(save: CalendarSave): CalendarSave {
  const last = save.history.at(-1);
  return last ? { ...save, now: last.from, history: save.history.slice(0, -1) } : save;
}
export const eventTime = (event: CalendarEvent) => event.day * 1440 + (event.minute ?? 0);
export const crossedEvents = (events: CalendarEvent[], from: number, to: number) => events.filter(e => e.status === '待处理' && eventTime(e) > from && eventTime(e) <= to);
export function parseCalendar(raw: string): CalendarSave | null {
  try {
    const x = JSON.parse(raw); const integer = (n: unknown, max: number) => Number.isInteger(n) && Number(n) >= 0 && Number(n) <= max;
    const text = (s: unknown, max: number) => typeof s === 'string' && s.length <= max;
    if (!x || x.version !== 1 || !text(x.id, 100) || !x.id || !text(x.name, 100) || !x.name.trim() || !integer(x.now, LAST_MINUTE) || !Array.isArray(x.events) || x.events.length > 500 || !Array.isArray(x.history) || x.history.length > 50) return null;
    const ids = new Set();
    for (const e of x.events) {
      if (!e || !text(e.id, 100) || !e.id || ids.has(e.id) || !text(e.title, 160) || !e.title.trim() || !integer(e.day, DAYS.length - 1) || (e.minute !== null && !integer(e.minute, 1439)) || !['剧情', '节庆', '派系', '期限', '自定义'].includes(e.kind) || !['待处理', '已完成', '已取消'].includes(e.status) || typeof e.public !== 'boolean' || !text(e.detail, 5000) || !text(e.source, 1000) || !text(e.condition, 1000)) return null;
      ids.add(e.id);
    }
    if (x.history.some((h: any) => !h || !integer(h.from, LAST_MINUTE) || !integer(h.to, LAST_MINUTE))) return null;
    return { version: 1, id: x.id, name: x.name, now: x.now, events: x.events, history: x.history };
  } catch { return null; }
}
