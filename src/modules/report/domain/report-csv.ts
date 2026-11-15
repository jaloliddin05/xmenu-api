import type { Lang } from 'src/infra/http/request-helpers';
import type { CourierReportRow, CourierReportTotals } from './courier-report';
import { CsvCell, toCsv } from './csv';
import type {
  ExternalReportRow,
  ExternalReportTotals,
} from './external-report';
import type { ProblemReport } from './problem-report';

/**
 * CSV files of the reports: the column names in the language of the request (ru, uz, en). Listed in
 * BOT_TEXT_FILES (npm run check:user-texts). Uzbek is Latin script.
 */
interface ReportTexts {
  total: string;
  couriers: [
    courier: string,
    shifts: string,
    hours: string,
    deliveries: string,
    cashDue: string,
    cashReceived: string,
    discrepancy: string,
    card: string,
    pay: string,
    unreconciled: string,
  ];
  external: [
    service: string,
    orders: string,
    cost: string,
    cashReceived: string,
    cashNotReceived: string,
    cashUnmarked: string,
  ];
  problems: [kind: string, reason: string, count: string];
  kinds: Record<
    'no_answer' | 'refused' | 'cannot_deliver' | 'returned' | 'cancelled',
    string
  >;
  refuseReasons: Record<string, string>;
  cancelledBy: Record<string, string>;
}

const TEXTS: Record<Lang, ReportTexts> = {
  ru: {
    total: 'Итого',
    couriers: [
      'Курьер',
      'Смен',
      'Часы смен',
      'Доставок',
      'К сдаче',
      'Получено',
      'Расхождение',
      'Оплачено картой',
      'Начислено',
      'Смен без сверки',
    ],
    external: [
      'Служба',
      'Заказов',
      'Расходы',
      'Наличные получены',
      'Наличные не получены',
      'Наличные не отмечены',
    ],
    problems: ['Проблема', 'Причина', 'Количество'],
    kinds: {
      no_answer: 'Не дозвонился',
      refused: 'Отказ гостя',
      cannot_deliver: 'Не могу доставить',
      returned: 'Возвращён в ресторан',
      cancelled: 'Отменён',
    },
    refuseReasons: {
      changed_mind: 'Передумал',
      wrong_order: 'Не тот заказ',
      quality: 'Недоволен качеством',
      other: 'Другое',
    },
    cancelledBy: {
      customer: 'гость',
      restaurant: 'ресторан',
      system: 'система',
    },
  },
  uz: {
    total: 'Jami',
    couriers: [
      'Kuryer',
      'Smenalar',
      'Smena soatlari',
      'Yetkazishlar',
      'Topshirilishi kerak',
      'Olindi',
      'Farq',
      'Karta bilan to‘langan',
      'Hisoblangan',
      'Solishtirilmagan smenalar',
    ],
    external: [
      'Xizmat',
      'Buyurtmalar',
      'Xarajatlar',
      'Naqd pul olindi',
      'Naqd pul olinmadi',
      'Naqd pul belgilanmagan',
    ],
    problems: ['Muammo', 'Sabab', 'Soni'],
    kinds: {
      no_answer: 'Qo‘ng‘iroqqa javob bermadi',
      refused: 'Mehmon rad etdi',
      cannot_deliver: 'Yetkaza olmayman',
      returned: 'Restoranga qaytarildi',
      cancelled: 'Bekor qilindi',
    },
    refuseReasons: {
      changed_mind: 'Fikridan qaytdi',
      wrong_order: 'Boshqa buyurtma',
      quality: 'Sifatdan norozi',
      other: 'Boshqa',
    },
    cancelledBy: {
      customer: 'mehmon',
      restaurant: 'restoran',
      system: 'tizim',
    },
  },
  en: {
    total: 'Total',
    couriers: [
      'Courier',
      'Shifts',
      'Shift hours',
      'Deliveries',
      'Cash to hand in',
      'Received',
      'Discrepancy',
      'Paid by card',
      'Accrued pay',
      'Shifts not reconciled',
    ],
    external: [
      'Service',
      'Orders',
      'Cost',
      'Cash received',
      'Cash not received',
      'Cash not marked',
    ],
    problems: ['Problem', 'Reason', 'Count'],
    kinds: {
      no_answer: 'No answer',
      refused: 'Guest refused',
      cannot_deliver: 'Cannot deliver',
      returned: 'Returned to the restaurant',
      cancelled: 'Cancelled',
    },
    refuseReasons: {
      changed_mind: 'Changed their mind',
      wrong_order: 'Wrong order',
      quality: 'Unhappy with quality',
      other: 'Other',
    },
    cancelledBy: {
      customer: 'guest',
      restaurant: 'restaurant',
      system: 'system',
    },
  },
};

const courierCells = (r: CourierReportTotals): CsvCell[] => [
  r.shifts,
  r.hours,
  r.deliveries,
  r.cashDue,
  r.cashReceived,
  r.discrepancy,
  r.card,
  r.pay,
  r.unreconciledShifts,
];

export function couriersCsv(
  report: { rows: CourierReportRow[]; total: CourierReportTotals },
  lang: Lang,
): string {
  const t = TEXTS[lang];
  return toCsv(t.couriers, [
    ...report.rows.map((r) => [r.name, ...courierCells(r)]),
    [t.total, ...courierCells(report.total)],
  ]);
}

const externalCells = (r: ExternalReportTotals): CsvCell[] => [
  r.orders,
  r.cost,
  r.cashReceived,
  r.cashNotReceived,
  r.cashUnmarked,
];

export function externalCsv(
  report: { rows: ExternalReportRow[]; total: ExternalReportTotals },
  lang: Lang,
): string {
  const t = TEXTS[lang];
  return toCsv(t.external, [
    ...report.rows.map((r) => [r.service, ...externalCells(r)]),
    [t.total, ...externalCells(report.total)],
  ]);
}

export function problemsCsv(report: ProblemReport, lang: Lang): string {
  const t = TEXTS[lang];
  const rows: CsvCell[][] = [
    [t.kinds.no_answer, null, report.counts.noAnswer],
    // Every kind has a row, zero included
    ...(report.refusedReasons.length
      ? report.refusedReasons.map((r) => [
          t.kinds.refused,
          t.refuseReasons[r.reason] ?? r.reason,
          r.count,
        ])
      : [[t.kinds.refused, null, 0]]),
    [t.kinds.cannot_deliver, null, report.counts.cannotDeliver],
    [t.kinds.returned, null, report.counts.returned],
    ...(report.cancelReasons.length
      ? report.cancelReasons.map((r) => [
          `${t.kinds.cancelled} (${t.cancelledBy[r.by] ?? r.by})`,
          r.reason,
          r.count,
        ])
      : [[t.kinds.cancelled, null, 0]]),
  ];
  return toCsv(t.problems, rows);
}
