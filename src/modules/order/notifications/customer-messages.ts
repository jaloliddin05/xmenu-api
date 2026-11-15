import type { Lang } from 'src/infra/http/request-helpers';

/**
 * Texts a customer gets about their order (Telegram today; the functions know nothing about the
 * channel). Uzbek is Latin script. Keep the three languages equal in meaning.
 */
export interface CustomerTexts {
  paymentReceived: (n: number) => string;
  accepted: (n: number) => string;
  preparing: (n: number) => string;
  onTheWay: (n: number) => string;
  onTheWayWith: (n: number, courier: string) => string;
  ready: (n: number) => string;
  readyForCourier: (n: number) => string;
  courierAtDoor: (n: number) => string;
  returned: (n: number) => string;
  completed: (n: number) => string;
  cancelledByVenue: (n: number) => string;
  refundNote: string;
  refunded: (n: number) => string;
}

export const CUSTOMER_TEXTS: Record<Lang, CustomerTexts> = {
  ru: {
    paymentReceived: (n) =>
      `💳 Оплата получена. Заказ №${n} отправлен в ресторан`,
    accepted: (n) => `✅ Ресторан принял заказ №${n}`,
    preparing: (n) => `👨‍🍳 Заказ №${n} готовится`,
    onTheWay: (n) => `🛵 Курьер везёт заказ №${n}`,
    onTheWayWith: (n, c) => `🛵 Заказ №${n} в пути, курьер ${c}`,
    ready: (n) => `🛍 Заказ №${n} готов к выдаче`,
    readyForCourier: (n) => `📦 Заказ №${n} готов и ждёт курьера`,
    courierAtDoor: (n) =>
      `📵 Курьер у двери с заказом №${n} и не может до вас дозвониться`,
    returned: (n) => `↩️ Заказ №${n} возвращён в ресторан`,
    completed: (n) => `🎉 Заказ №${n} выполнен. Приятного аппетита!`,
    cancelledByVenue: (n) => `😔 Заказ №${n} отменён рестораном.`,
    refundNote: 'Деньги за заказ вернутся на ваш счёт.',
    refunded: (n) => `💸 Деньги за заказ №${n} возвращены`,
  },
  uz: {
    paymentReceived: (n) =>
      `💳 To'lov qabul qilindi. №${n} buyurtma restoranga yuborildi`,
    accepted: (n) => `✅ Restoran №${n} buyurtmani qabul qildi`,
    preparing: (n) => `👨‍🍳 №${n} buyurtma tayyorlanmoqda`,
    onTheWay: (n) => `🛵 Kuryer №${n} buyurtmani olib kelmoqda`,
    onTheWayWith: (n, c) => `🛵 №${n} buyurtma yo'lda, kuryer ${c}`,
    ready: (n) => `🛍 №${n} buyurtma topshirishga tayyor`,
    readyForCourier: (n) => `📦 №${n} buyurtma tayyor va kuryerni kutmoqda`,
    courierAtDoor: (n) =>
      `📵 Kuryer №${n} buyurtma bilan eshik oldida, sizga qo'ng'iroq qila olmayapti`,
    returned: (n) => `↩️ №${n} buyurtma restoranga qaytarildi`,
    completed: (n) => `🎉 №${n} buyurtma bajarildi. Yoqimli ishtaha!`,
    cancelledByVenue: (n) =>
      `😔 №${n} buyurtma restoran tomonidan bekor qilindi.`,
    refundNote: "Buyurtma uchun to'langan pul hisobingizga qaytariladi.",
    refunded: (n) => `💸 №${n} buyurtma uchun to'langan pul qaytarildi`,
  },
  en: {
    paymentReceived: (n) =>
      `💳 Payment received. Order #${n} has been sent to the restaurant`,
    accepted: (n) => `✅ The restaurant accepted order #${n}`,
    preparing: (n) => `👨‍🍳 Order #${n} is being prepared`,
    onTheWay: (n) => `🛵 The courier is on the way with order #${n}`,
    onTheWayWith: (n, c) => `🛵 Order #${n} is on the way, courier ${c}`,
    ready: (n) => `🛍 Order #${n} is ready for pickup`,
    readyForCourier: (n) =>
      `📦 Order #${n} is ready and waiting for the courier`,
    courierAtDoor: (n) =>
      `📵 The courier is at your door with order #${n} and cannot reach you`,
    returned: (n) => `↩️ Order #${n} was returned to the restaurant`,
    completed: (n) => `🎉 Order #${n} is completed. Enjoy your meal!`,
    cancelledByVenue: (n) => `😔 Order #${n} was cancelled by the restaurant.`,
    refundNote: 'The money for the order will be returned to your account.',
    refunded: (n) => `💸 The money for order #${n} has been refunded`,
  },
};
