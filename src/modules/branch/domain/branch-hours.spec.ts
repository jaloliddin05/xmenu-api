import {
  BranchSchedule,
  DayHours,
  evaluateOpenState,
  formatHours,
  hasSchedule,
} from './branch-hours';

const day = (weekday: number, opensAt: string, closesAt: string, extra: Partial<DayHours> = {}): DayHours => ({
  weekday,
  opensAt,
  closesAt,
  is24h: false,
  isClosed: false,
  ...extra,
});

const everyDay = (opensAt: string, closesAt: string) =>
  [1, 2, 3, 4, 5, 6, 7].map((w) => day(w, opensAt, closesAt));

// Toshkent = UTC+5, DST yo'q. 2026-10-12 — dushanba.
const tashkent = (iso: string) => new Date(`${iso}+05:00`);

describe('evaluateOpenState', () => {
  const schedule = (over: Partial<BranchSchedule> = {}): BranchSchedule => ({
    timezone: 'Asia/Tashkent',
    days: everyDay('09:00', '23:00'),
    exceptions: [],
    ...over,
  });

  it('is closed with no next opening when the branch has no schedule at all', () => {
    expect(evaluateOpenState(schedule({ days: [] }), new Date())).toEqual({ isOpen: false, opensAt: null });
    expect(hasSchedule(schedule({ days: [] }))).toBe(false);
    expect(hasSchedule(schedule())).toBe(true);
  });

  it('round the clock is explicit: is24h on all seven days is open at any minute', () => {
    const s = schedule({ days: [1, 2, 3, 4, 5, 6, 7].map((w) => day(w, '00:00', '00:00', { is24h: true })) });
    for (const t of ['2026-10-12T00:00:00', '2026-10-14T13:37:00', '2026-10-18T23:59:00']) {
      expect(evaluateOpenState(s, tashkent(t))).toEqual({ isOpen: true, opensAt: null });
    }
    expect(formatHours(s.days)).toBe('Круглосуточно');
  });

  it('is open inside the interval', () => {
    expect(evaluateOpenState(schedule(), tashkent('2026-10-12T12:00:00'))).toEqual({ isOpen: true, opensAt: null });
  });

  it('is closed before opening and reports today\'s opening time', () => {
    expect(evaluateOpenState(schedule(), tashkent('2026-10-12T07:30:00'))).toEqual({ isOpen: false, opensAt: '09:00' });
  });

  it('is closed after closing and reports the next day\'s opening time', () => {
    expect(evaluateOpenState(schedule(), tashkent('2026-10-12T23:30:00'))).toEqual({ isOpen: false, opensAt: '09:00' });
  });

  it('closing time itself is already closed', () => {
    expect(evaluateOpenState(schedule(), tashkent('2026-10-12T23:00:00')).isOpen).toBe(false);
  });

  it('uses the branch time zone, not the server\'s', () => {
    // 2026-10-12T05:00Z == 10:00 in Tashkent
    expect(evaluateOpenState(schedule(), new Date('2026-10-12T05:00:00Z')).isOpen).toBe(true);
    // 2026-10-12T03:00Z == 08:00 in Tashkent
    expect(evaluateOpenState(schedule(), new Date('2026-10-12T03:00:00Z')).isOpen).toBe(false);
  });

  it('handles an overnight shift: open late evening and the next early morning', () => {
    const s = schedule({ days: everyDay('18:00', '03:00') });
    expect(evaluateOpenState(s, tashkent('2026-10-12T23:30:00')).isOpen).toBe(true);
    expect(evaluateOpenState(s, tashkent('2026-10-13T02:00:00')).isOpen).toBe(true);
    expect(evaluateOpenState(s, tashkent('2026-10-13T03:00:00')).isOpen).toBe(false);
    expect(evaluateOpenState(s, tashkent('2026-10-12T12:00:00'))).toEqual({ isOpen: false, opensAt: '18:00' });
  });

  it('treats closes_at 00:00 as midnight of the same day', () => {
    const s = schedule({ days: everyDay('09:00', '00:00') });
    expect(evaluateOpenState(s, tashkent('2026-10-12T23:59:00')).isOpen).toBe(true);
    expect(evaluateOpenState(s, tashkent('2026-10-13T00:01:00')).isOpen).toBe(false);
  });

  it('a 24h day is always open', () => {
    const s = schedule({ days: [1, 2, 3, 4, 5, 6, 7].map((w) => day(w, '00:00', '00:00', { is24h: true })) });
    expect(evaluateOpenState(s, tashkent('2026-10-12T03:33:00')).isOpen).toBe(true);
  });

  it('skips a closed weekday when looking for the next opening', () => {
    // Yakshanba (7) yopiq; shanba kechasi yopilgach keyingi ochilish — dushanba
    const days = [1, 2, 3, 4, 5, 6].map((w) => day(w, '09:00', '22:00')).concat(day(7, '00:00', '00:00', { isClosed: true }));
    expect(evaluateOpenState(schedule({ days }), tashkent('2026-10-17T23:00:00'))).toEqual({ isOpen: false, opensAt: '09:00' });
    expect(evaluateOpenState(schedule({ days }), tashkent('2026-10-18T12:00:00')).isOpen).toBe(false);
  });

  it('a date exception overrides the weekly schedule', () => {
    const closed = schedule({
      exceptions: [{ date: '2026-10-12', opensAt: null, closesAt: null, is24h: false, isClosed: true }],
    });
    expect(evaluateOpenState(closed, tashkent('2026-10-12T12:00:00'))).toEqual({ isOpen: false, opensAt: '09:00' });

    const shortDay = schedule({
      exceptions: [{ date: '2026-10-12', opensAt: '12:00', closesAt: '15:00', is24h: false, isClosed: false }],
    });
    expect(evaluateOpenState(shortDay, tashkent('2026-10-12T11:00:00')).isOpen).toBe(false);
    expect(evaluateOpenState(shortDay, tashkent('2026-10-12T13:00:00')).isOpen).toBe(true);
  });
});

describe('formatHours', () => {
  it('is empty without a schedule', () => {
    expect(formatHours([])).toBe('');
  });

  it('all days the same -> "Ежедневно"', () => {
    expect(formatHours(everyDay('09:00', '23:00'))).toBe('Ежедневно 09:00–23:00');
  });

  it('24/7 in each language', () => {
    const days = [1, 2, 3, 4, 5, 6, 7].map((w) => day(w, '00:00', '00:00', { is24h: true }));
    expect(formatHours(days, 'ru')).toBe('Круглосуточно');
    expect(formatHours(days, 'uz')).toBe('Kechayu kunduz');
    expect(formatHours(days, 'en')).toBe('24/7');
  });

  it('groups consecutive days with equal hours', () => {
    const days = [1, 2, 3, 4, 5].map((w) => day(w, '09:00', '23:00')).concat([day(6, '10:00', '22:00'), day(7, '10:00', '22:00')]);
    expect(formatHours(days)).toBe('Пн–Пт 09:00–23:00, Сб–Вс 10:00–22:00');
  });

  it('leaves closed days out', () => {
    const days = [1, 2, 3, 4, 5, 6].map((w) => day(w, '09:00', '22:00')).concat(day(7, '00:00', '00:00', { isClosed: true }));
    expect(formatHours(days)).toBe('Пн–Сб 09:00–22:00');
  });

  it('English labels', () => {
    expect(formatHours(everyDay('09:00', '23:00'), 'en')).toBe('Daily 09:00–23:00');
  });
});
