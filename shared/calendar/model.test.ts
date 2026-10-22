import { seedEvents } from '../../worker/src/calendar';
import { describe, expect, it } from 'vitest';
import { advance, crossedEvents, DAYS, dayIndex, LAST_MINUTE, newCalendar, parseCalendar, undoAdvance } from './model';

describe('1492 DR calendar', () => {
  it('keeps holidays outside the thirty-day months, including Shieldmeet', () => {
    expect(DAYS).toHaveLength(366);
    for (let month = 1; month <= 12; month++) expect(DAYS.filter(d => d.month === month && d.day)).toHaveLength(30);
    expect(DAYS[dayIndex(1, 30) + 1].label).toBe('仲冬节');
    expect(DAYS[dayIndex(7, 30) + 1].label).toBe('仲夏节');
    expect(DAYS[dayIndex(7, 30) + 2].label).toBe('盾会');
    expect(dayIndex(8, 1)).toBe(dayIndex(7, 30) + 3);
  });
  it('uses the agreed feast date and keeps secret deadlines private', () => {
    const s = newCalendar('test', seedEvents());
    expect(s.events.find(e => e.id === 'feast')).toMatchObject({ day: dayIndex(4, 10), public: false });
    expect(s.events.find(e => e.id === 'souls')).toMatchObject({ day: dayIndex(4, 11), public: false });
    expect(s.events.find(e => e.id === 'fireball')).toMatchObject({ day: dayIndex(3, 22), public: false });
    expect(parseCalendar(JSON.stringify(s))).toEqual(s);
  });
  it('reports all crossed pending events without executing them and supports clock undo', () => {
    const s = newCalendar('test', seedEvents());
    s.events.find(e => e.id === 'opening')!.status = '已完成';
    const next = advance(s, dayIndex(4, 12) * 1440);
    const crossed = crossedEvents(s.events, s.now, next.now);
    expect(crossed.some(e => e.id === 'feast')).toBe(true);
    expect(crossed.some(e => e.id === 'opening')).toBe(false);
    expect(next.events).toEqual(s.events);
    expect(undoAdvance(next)).toEqual(s);
    expect(crossedEvents(s.events, next.now, s.now)).toEqual([]);
  });
  it('rejects out-of-year dates and bounds history', () => {
    let s = newCalendar('test', seedEvents());
    for (const n of [-1, LAST_MINUTE + 1, NaN, 1.5]) expect(advance(s, n)).toBe(s);
    for (let i = 0; i < 60; i++) s = advance(s, s.now + 60);
    expect(s.history).toHaveLength(50);
  });
  it('rejects malformed backups and duplicate event identifiers', () => {
    const s = newCalendar('test', seedEvents());
    expect(parseCalendar('not json')).toBeNull();
    expect(parseCalendar(JSON.stringify({ ...s, now: LAST_MINUTE + 1 }))).toBeNull();
    expect(parseCalendar(JSON.stringify({ ...s, events: [s.events[0], s.events[0]] }))).toBeNull();
    expect(parseCalendar(JSON.stringify({ ...s, events: [{ ...s.events[0], day: 366 }] }))).toBeNull();
    expect(parseCalendar(JSON.stringify({ ...s, events: [{ ...s.events[0], public: 'false' }] }))).toBeNull();
  });
});
