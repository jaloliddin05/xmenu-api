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
  ready: (n: number) => string;
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
    ready: (n) => `🛍 Заказ №${n} готов к выдаче`,
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
    ready: (n) => `🛍 №${n} buyurtma topshirishga tayyor`,
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
    ready: (n) => `🛍 Order #${n} is ready for pickup`,
    completed: (n) => `🎉 Order #${n} is completed. Enjoy your meal!`,
    cancelledByVenue: (n) => `😔 Order #${n} was cancelled by the restaurant.`,
    refundNote: 'The money for the order will be returned to your account.',
    refunded: (n) => `💸 The money for order #${n} has been refunded`,
  },
};
