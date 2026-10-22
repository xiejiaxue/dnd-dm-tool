import { DAYS, dayIndex, type CalendarEvent } from '../calendar/model';
export const CAMPAIGN_START_DAY = dayIndex(3, 1);
export const DEFAULT_OPENING_DAY = dayIndex(3, 20);
export function tavernDate(day: number, startDay = DEFAULT_OPENING_DAY) {
  let remaining = startDay + day - 1;
  let year = 1492;
  while (remaining >= (year % 4 === 0 ? 366 : 365)) remaining -= year++ % 4 === 0 ? 366 : 365;
  const dates = year % 4 === 0 ? DAYS : DAYS.filter(d => d.key !== 'holiday-7-1');
  return { year, date: dates[remaining], absoluteDay: startDay + day - 1 };
}
export function todayPublicEvents(events: CalendarEvent[], day: number, startDay?: number) {
  const date = tavernDate(day, startDay);
  return date.year === 1492 ? events.filter(e => e.public && e.day === date.absoluteDay && e.status !== '已取消') : [];
}

export function recordedDateLabel(absoluteDay?: number): string {
  if (absoluteDay === undefined) return '费伦日期未记录（旧存档）';
  const { year, date } = tavernDate(absoluteDay + 1, 0);
  return `${year} DR · ${date.label}`;
}
