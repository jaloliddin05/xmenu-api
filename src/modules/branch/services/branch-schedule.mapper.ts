import type { branch, branch_hours_exception, branch_working_hours } from '@prisma/client';
import { BranchSchedule } from '../domain/branch-hours';

export type BranchWithSchedule = branch & {
  working_hours: branch_working_hours[];
  hours_exceptions: branch_hours_exception[];
};

/** DB qatorlari → sof funksiyalar kutadigan jadval. Sana filial vaqt zonasidagi YYYY-MM-DD. */
export function toSchedule(b: BranchWithSchedule): BranchSchedule {
  return {
    timezone: b.timezone,
    days: b.working_hours.map((d) => ({
      weekday: d.weekday,
      opensAt: d.opens_at,
      closesAt: d.closes_at,
      is24h: d.is_24h,
      isClosed: d.is_closed,
    })),
    exceptions: b.hours_exceptions.map((e) => ({
      date: e.date.toISOString().slice(0, 10),
      opensAt: e.opens_at,
      closesAt: e.closes_at,
      is24h: e.is_24h,
      isClosed: e.is_closed,
    })),
  };
}
