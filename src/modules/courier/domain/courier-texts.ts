/**
 * Texts of the courier bot (docs/DELIVERY.md, "Бот курьера"). Uzbek is Latin script. Keep the three
 * languages equal in meaning. Listed in BOT_TEXT_FILES (npm run check:user-texts).
 */
export type CourierLang = 'ru' | 'uz' | 'en';

export interface CourierTexts {
  // menu (reply keyboard)
  startShift: string;
  endShift: string;
  myOrders: string;
  // invitation and access
  linked: (venue: string) => string;
  inviteInvalid: string;
  inviteOtherCourier: string;
  notCourier: string;
  // shift
  shiftStarted: string;
  shiftAlreadyOpen: string;
  shiftEnded: string;
  shiftNotOpen: string;
  shiftHasOrders: (n: number) => string;
  shiftClosedByStaff: string;
  noOrders: string;
  disabled: string;
  // order card
  order: (n: number) => string;
  status: Record<CourierCardStatus, string>;
  from: string;
  to: string;
  guest: string;
  comment: string;
  entrance: string;
  floor: string;
  apartment: string;
  map: string;
  items: string;
  total: string;
  payCash: string;
  payOnline: string;
  changeFrom: string;
  doorReason: string;
  // buttons
  pickedUp: string;
  pickedUpAll: (n: number) => string;
  deliveredCash: string;
  delivered: string;
  noAnswer: string;
  refused: string;
  cannotDeliver: string;
  refusedWhy: string;
  back: string;
  refuseReasons: Record<RefuseReason, string>;
  // answers to a button press
  done: string;
  alreadyDone: string;
  notYours: string;
  notAvailable: string;
  // short events
  unassigned: (n: number) => string;
}

export type CourierCardStatus =
  | 'assigned'
  | 'ready'
  | 'on_the_way'
  | 'no_answer'
  | 'refused'
  | 'completed'
  | 'cancelled'
  | 'returned'
  | 'handed_over'
  | 'taken_off';

export const REFUSE_REASONS = [
  'changed_mind',
  'wrong_order',
  'quality',
  'other',
] as const;
export type RefuseReason = (typeof REFUSE_REASONS)[number];

export const COURIER_TEXTS: Record<CourierLang, CourierTexts> = {
  ru: {
    startShift: '▶️ Начать смену',
    endShift: '⏹ Закончить смену',
    myOrders: '📋 Мои заказы',
    linked: (venue) =>
      `✅ Вы подключены курьером «${venue}». Начните смену, чтобы получать заказы.`,
    inviteInvalid:
      'Ссылка недействительна: её уже использовали или срок истёк. Попросите у ресторана новую.',
    inviteOtherCourier:
      'Этот Telegram уже подключён к другому курьеру этого ресторана.',
    notCourier: 'Эта кнопка только для курьеров ресторана.',
    shiftStarted: '✅ Смена начата. Ждите заказов.',
    shiftAlreadyOpen: 'Смена уже идёт.',
    shiftEnded: '⏹ Смена закончена. Сдайте наличные оператору.',
    shiftNotOpen: 'Смена не начата.',
    shiftHasOrders: (n) =>
      `Закончить смену нельзя: на вас незавершённых заказов: ${n}. Доставьте их или попросите оператора переназначить.`,
    shiftClosedByStaff:
      '⏹ Оператор закончил вашу смену. Сдайте наличные оператору.',
    noOrders: 'У вас нет активных заказов.',
    disabled: 'Доступ отключён рестораном.',
    order: (n) => `Заказ №${n}`,
    status: {
      assigned: '🕒 Назначен вам, готовится',
      ready: '📦 Готов, можно забирать',
      on_the_way: '🛵 В пути',
      no_answer: '📵 Не дозвонился, ждём решения оператора',
      refused: '🚫 Отказ гостя, ждём решения оператора',
      completed: '✅ Доставлен',
      cancelled: '❌ Отменён',
      returned: '↩️ Возвращён в ресторан',
      handed_over: '↗️ Передан внешней службе',
      taken_off: '➖ Снят с вас',
    },
    from: 'Забрать',
    to: 'Доставить',
    guest: 'Гость',
    comment: 'Комментарий',
    entrance: 'подъезд',
    floor: 'этаж',
    apartment: 'кв.',
    map: 'Карта',
    items: 'Состав',
    total: 'К оплате',
    payCash: 'наличные',
    payOnline: 'оплачен онлайн',
    changeFrom: 'Сдача с',
    doorReason: 'Причина',
    pickedUp: '📦 Забрал',
    pickedUpAll: (n) => `📦 Забрал все (${n})`,
    deliveredCash: '✅ Доставил, деньги получены',
    delivered: '✅ Доставил',
    noAnswer: '📵 Не дозвонился',
    refused: '🚫 Отказ гостя',
    cannotDeliver: '⚠️ Не могу доставить',
    refusedWhy: 'Почему гость отказался?',
    back: '← Назад',
    refuseReasons: {
      changed_mind: 'Передумал',
      wrong_order: 'Не тот заказ',
      quality: 'Недоволен качеством',
      other: 'Другое',
    },
    done: 'Готово',
    alreadyDone: 'Уже отмечено',
    notYours: 'Это не ваш заказ',
    notAvailable: 'Сейчас это действие недоступно',
    unassigned: (n) => `Заказ №${n} снят с вас`,
  },
  uz: {
    startShift: '▶️ Smenani boshlash',
    endShift: '⏹ Smenani tugatish',
    myOrders: '📋 Buyurtmalarim',
    linked: (venue) =>
      `✅ Siz «${venue}» kuryeri sifatida ulandingiz. Buyurtmalar olish uchun smenani boshlang.`,
    inviteInvalid:
      "Havola yaroqsiz: u ishlatilgan yoki muddati o'tgan. Restorandan yangisini so'rang.",
    inviteOtherCourier:
      'Bu Telegram ushbu restoranning boshqa kuryeriga ulangan.',
    notCourier: 'Bu tugma faqat restoran kuryerlari uchun.',
    shiftStarted: '✅ Smena boshlandi. Buyurtmalarni kuting.',
    shiftAlreadyOpen: 'Smena allaqachon davom etmoqda.',
    shiftEnded: '⏹ Smena tugadi. Naqd pulni operatorga topshiring.',
    shiftNotOpen: 'Smena boshlanmagan.',
    shiftHasOrders: (n) =>
      `Smenani tugatib bo'lmaydi: sizda tugallanmagan buyurtmalar bor: ${n}. Ularni yetkazing yoki operatordan boshqa kuryerga berishni so'rang.`,
    shiftClosedByStaff:
      '⏹ Operator smenangizni tugatdi. Naqd pulni operatorga topshiring.',
    noOrders: "Sizda faol buyurtmalar yo'q.",
    disabled: "Restoran kirishni o'chirib qo'ydi.",
    order: (n) => `№${n} buyurtma`,
    status: {
      assigned: '🕒 Sizga biriktirildi, tayyorlanmoqda',
      ready: '📦 Tayyor, olib ketish mumkin',
      on_the_way: "🛵 Yo'lda",
      no_answer: '📵 Mijoz javob bermadi, operator qarorini kuting',
      refused: '🚫 Mijoz rad etdi, operator qarorini kuting',
      completed: '✅ Yetkazildi',
      cancelled: '❌ Bekor qilindi',
      returned: '↩️ Restoranga qaytarildi',
      handed_over: '↗️ Tashqi xizmatga berildi',
      taken_off: '➖ Sizdan olindi',
    },
    from: 'Olib ketish',
    to: 'Yetkazish',
    guest: 'Mijoz',
    comment: 'Izoh',
    entrance: 'podyezd',
    floor: 'qavat',
    apartment: 'xonadon',
    map: 'Xarita',
    items: 'Tarkibi',
    total: "To'lov",
    payCash: 'naqd',
    payOnline: "onlayn to'langan",
    changeFrom: 'Qaytim',
    doorReason: 'Sabab',
    pickedUp: '📦 Oldim',
    pickedUpAll: (n) => `📦 Hammasini oldim (${n})`,
    deliveredCash: '✅ Yetkazdim, pul olindi',
    delivered: '✅ Yetkazdim',
    noAnswer: '📵 Javob bermadi',
    refused: '🚫 Mijoz rad etdi',
    cannotDeliver: '⚠️ Yetkaza olmayman',
    refusedWhy: 'Mijoz nega rad etdi?',
    back: '← Orqaga',
    refuseReasons: {
      changed_mind: "Fikrini o'zgartirdi",
      wrong_order: 'Boshqa buyurtma',
      quality: 'Sifatdan norozi',
      other: 'Boshqa',
    },
    done: 'Bajarildi',
    alreadyDone: 'Allaqachon belgilangan',
    notYours: 'Bu sizning buyurtmangiz emas',
    notAvailable: 'Hozir bu amal mavjud emas',
    unassigned: (n) => `№${n} buyurtma sizdan olindi`,
  },
  en: {
    startShift: '▶️ Start shift',
    endShift: '⏹ End shift',
    myOrders: '📋 My orders',
    linked: (venue) =>
      `✅ You are connected as a courier of «${venue}». Start a shift to get orders.`,
    inviteInvalid:
      'The link is not valid: it was already used or has expired. Ask the restaurant for a new one.',
    inviteOtherCourier:
      'This Telegram account is already connected to another courier of this restaurant.',
    notCourier: 'This button is for the restaurant couriers only.',
    shiftStarted: '✅ Shift started. Wait for orders.',
    shiftAlreadyOpen: 'The shift is already on.',
    shiftEnded: '⏹ Shift ended. Hand the cash to the operator.',
    shiftNotOpen: 'The shift has not started.',
    shiftHasOrders: (n) =>
      `You cannot end the shift: unfinished orders on you: ${n}. Deliver them or ask the operator to reassign.`,
    shiftClosedByStaff:
      '⏹ The operator ended your shift. Hand the cash to the operator.',
    noOrders: 'You have no active orders.',
    disabled: 'The restaurant turned off your access.',
    order: (n) => `Order #${n}`,
    status: {
      assigned: '🕒 Assigned to you, being prepared',
      ready: '📦 Ready for pickup',
      on_the_way: '🛵 On the way',
      no_answer: "📵 Guest not answering, waiting for the operator's decision",
      refused: "🚫 Guest refused, waiting for the operator's decision",
      completed: '✅ Delivered',
      cancelled: '❌ Cancelled',
      returned: '↩️ Returned to the restaurant',
      handed_over: '↗️ Handed to an external service',
      taken_off: '➖ Taken off you',
    },
    from: 'Pick up',
    to: 'Deliver to',
    guest: 'Guest',
    comment: 'Comment',
    entrance: 'entrance',
    floor: 'floor',
    apartment: 'apt.',
    map: 'Map',
    items: 'Items',
    total: 'To pay',
    payCash: 'cash',
    payOnline: 'paid online',
    changeFrom: 'Change from',
    doorReason: 'Reason',
    pickedUp: '📦 Picked up',
    pickedUpAll: (n) => `📦 Picked up all (${n})`,
    deliveredCash: '✅ Delivered, cash received',
    delivered: '✅ Delivered',
    noAnswer: '📵 No answer',
    refused: '🚫 Guest refused',
    cannotDeliver: '⚠️ Cannot deliver',
    refusedWhy: 'Why did the guest refuse?',
    back: '← Back',
    refuseReasons: {
      changed_mind: 'Changed their mind',
      wrong_order: 'Wrong order',
      quality: 'Unhappy with quality',
      other: 'Other',
    },
    done: 'Done',
    alreadyDone: 'Already marked',
    notYours: 'This is not your order',
    notAvailable: 'This action is not available now',
    unassigned: (n) => `Order #${n} was taken off you`,
  },
};

/** Telegram language_code → bot language; anything else is Russian. */
export function courierLang(code: string | null | undefined): CourierLang {
  const c = (code ?? '').toLowerCase().slice(0, 2);
  return c === 'uz' || c === 'en' ? c : 'ru';
}
