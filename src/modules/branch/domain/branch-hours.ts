/**
 * Filial ish vaqti: jadvaldan "hozir ochiqmi", "qachon ochiladi" va ko'rsatish
 * uchun tayyor matnni hisoblaydi. Sof funksiyalar (DB yo'q) — shuning uchun
 * GET /branches va POST /orders (branch_closed) BIR XIL natija beradi.
 *
 * Qoidalar:
 *  - weekday ISO: 1 = dushanba ... 7 = yakshanba.
 *  - closes_at <= opens_at (closes_at != 00:00) — tungi smena: ertasi kuni yopiladi.
 *  - closes_at = 00:00 — yarim tunda yopiladi (shu kun ichida).
 *  - Sana bo'yicha istisno (bayram, ta'mir) haftalik jadvaldan ustun.
 *  - Jadval umuman yo'q bo'lsa — isOpen = null ("noma'lum"), hech narsa bloklanmaydi.
 */

export interface DayHours {
  weekday: number;
  opensAt: string;
  closesAt: string;
  is24h: boolean;
  isClosed: boolean;
}

export interface HoursException {
  /** YYYY-MM-DD (filial vaqt zonasidagi sana) */
  date: string;
  opensAt: string | null;
  closesAt: string | null;
  is24h: boolean;
  isClosed: boolean;
}

export interface BranchSchedule {
  timezone: string;
  days: DayHours[];
  exceptions: HoursException[];
}

export interface OpenState {
  isOpen: boolean | null;
  /** "HH:mm" — yopiq bo'lsa, keyingi ochilish vaqti */
  opensAt: string | null;
}

export type HoursLang = 'ru' | 'uz' | 'en';

interface Interval {
  /** daqiqa, 0..1440 */
  start: number;
  /** daqiqa; 1440 dan katta bo'lsa — ertasi kunga o'tadi */
  end: number;
}

const DAY = 1440;

export function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return 0;
  return Number(m[1]) * 60 + Number(m[2]);
}

const WEEKDAY_INDEX: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Berilgan vaqt zonasidagi sana, ISO hafta kuni va kun ichidagi daqiqa. */
export function localParts(
  now: Date,
  timeZone: string,
): { date: string; weekday: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 1,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** YYYY-MM-DD ga `delta` kun qo'shadi (vaqt zonasiga bog'liq emas). */
export function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const wrapWeekday = (n: number) => ((((n - 1) % 7) + 7) % 7) + 1;

/** Kun uchun oraliq (yopiq bo'lsa null). Istisno haftalik jadvaldan ustun. */
function intervalFor(
  schedule: BranchSchedule,
  date: string,
  weekday: number,
): Interval | null {
  const exception = schedule.exceptions.find((e) => e.date === date);
  const src = exception
    ? {
        isClosed: exception.isClosed,
        is24h: exception.is24h,
        opensAt: exception.opensAt ?? '00:00',
        closesAt: exception.closesAt ?? '00:00',
      }
    : schedule.days.find((d) => d.weekday === weekday);

  // Hafta kuni uchun qator bo'lmasa — o'sha kun yopiq deb hisoblanadi
  // (jadval boshqa kunlar uchun to'ldirilgan).
  if (!src || src.isClosed) return null;
  if (src.is24h) return { start: 0, end: DAY };

  const start = toMinutes(src.opensAt);
  const end = toMinutes(src.closesAt);
  if (end === 0) return { start, end: DAY }; // 00:00 — yarim tun
  if (end <= start) return { start, end: DAY + end }; // tungi smena
  return { start, end };
}

export function evaluateOpenState(
  schedule: BranchSchedule,
  now: Date,
): OpenState {
  if (schedule.days.length === 0 && schedule.exceptions.length === 0) {
    return { isOpen: null, opensAt: null };
  }

  const today = localParts(now, schedule.timezone);
  const todayInterval = intervalFor(schedule, today.date, today.weekday);
  if (
    todayInterval &&
    today.minutes >= todayInterval.start &&
    today.minutes < Math.min(todayInterval.end, DAY)
  ) {
    return { isOpen: true, opensAt: null };
  }

  // Kechagi tungi smena bugun ertalab davom etishi mumkin.
  const yesterdayInterval = intervalFor(
    schedule,
    addDays(today.date, -1),
    wrapWeekday(today.weekday - 1),
  );
  if (
    yesterdayInterval &&
    yesterdayInterval.end > DAY &&
    today.minutes < yesterdayInterval.end - DAY
  ) {
    return { isOpen: true, opensAt: null };
  }

  // Yopiq: keyingi ochilish.
  if (todayInterval && todayInterval.start > today.minutes) {
    return { isOpen: false, opensAt: formatMinutes(todayInterval.start) };
  }
  for (let i = 1; i <= 7; i++) {
    const interval = intervalFor(
      schedule,
      addDays(today.date, i),
      wrapWeekday(today.weekday + i),
    );
    if (interval) return { isOpen: false, opensAt: formatMinutes(interval.start) };
  }
  return { isOpen: false, opensAt: null };
}

function formatMinutes(total: number): string {
  const m = total % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- matn

const WORDS: Record<
  HoursLang,
  { all: string; daily: string; closed: string; days: string[] }
> = {
  ru: {
    all: 'Круглосуточно',
    daily: 'Ежедневно',
    closed: 'выходной',
    days: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
  },
  uz: {
    all: 'Kechayu kunduz',
    daily: 'Har kuni',
    closed: 'dam olish kuni',
    days: ['Du', 'Se', 'Chor', 'Pay', 'Ju', 'Sha', 'Yak'],
  },
  en: {
    all: '24/7',
    daily: 'Daily',
    closed: 'closed',
    days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
  },
};

const signature = (d: DayHours | undefined): string =>
  !d || d.isClosed ? 'closed' : d.is24h ? '24h' : `${d.opensAt}-${d.closesAt}`;

/**
 * "Ежедневно 09:00–23:00", "Пн–Пт 09:00–23:00, Сб–Вс 10:00–22:00",
 * "Круглосуточно". Jadval bo'sh bo'lsa — bo'sh qator.
 */
export function formatHours(days: DayHours[], lang: HoursLang = 'ru'): string {
  if (days.length === 0) return '';
  const w = WORDS[lang] ?? WORDS.ru;

  const byDay = new Map(days.map((d) => [d.weekday, d]));
  const sigs = Array.from({ length: 7 }, (_, i) => signature(byDay.get(i + 1)));

  const label = (sig: string) => (sig === '24h' ? w.all : sig === 'closed' ? w.closed : sig.replace('-', '–'));

  if (sigs.every((s) => s === sigs[0])) {
    if (sigs[0] === '24h') return w.all;
    if (sigs[0] === 'closed') return '';
    return `${w.daily} ${label(sigs[0])}`;
  }

  const runs: { from: number; to: number; sig: string }[] = [];
  sigs.forEach((sig, i) => {
    const last = runs[runs.length - 1];
    if (last && last.sig === sig) last.to = i;
    else runs.push({ from: i, to: i, sig });
  });

  return runs
    .filter((r) => r.sig !== 'closed')
    .map((r) => {
      const range = r.from === r.to ? w.days[r.from] : `${w.days[r.from]}–${w.days[r.to]}`;
      return `${range} ${label(r.sig)}`;
    })
    .join(', ');
}
