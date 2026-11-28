import { fmtSum } from 'src/modules/order/notifications/order-messages';

/** Events that send a web push to the venue staff (docs/API.md, "Web push сотрудникам"). */
export type StaffPushEvent = 'new_order' | 'at_door' | 'cannot_deliver';

/** What a push text may use: no guest data (phone, address, name, items) ever goes to the push services. */
export interface StaffPushOrder {
  number: number;
  fulfillment: 'delivery' | 'pickup';
  itemsCount: number;
  total: number;
  doorProblem: 'no_answer' | 'refused' | null;
}

const positions = (n: number): string => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} позиция`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
    return `${n} позиции`;
  return `${n} позиций`;
};

/** Title and body of the notification (Russian: the dashboard language). */
export function staffPushText(
  event: StaffPushEvent,
  order: StaffPushOrder,
): { title: string; body: string } {
  switch (event) {
    case 'new_order':
      return {
        title: `Новый заказ №${order.number}`,
        body: [
          order.fulfillment === 'delivery' ? 'Доставка' : 'Самовывоз',
          positions(order.itemsCount),
          fmtSum(order.total),
        ].join(' · '),
      };
    case 'at_door':
      return order.doorProblem === 'refused'
        ? {
            title: `№${order.number}: гость отказался от заказа`,
            body: 'Решите, вернуть заказ в ресторан или отменить',
          }
        : {
            title: `№${order.number}: курьер у двери, гость не отвечает`,
            body: 'Позвоните гостю или решите, что делать с заказом',
          };
    case 'cannot_deliver':
      return {
        title: `№${order.number}: курьер не может доставить`,
        body: 'Заказ снова готов, назначьте другого курьера',
      };
  }
}
