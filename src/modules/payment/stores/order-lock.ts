import { Prisma } from '@prisma/client';

/**
 * Buyurtma qatorini tranzaksiya oxirigacha bloklaydi (SELECT ... FOR UPDATE).
 * To'lov webhook'i, mijoz bekor qilishi va avto-muddat bir vaqtda kelganda
 * ular navbat bilan ishlaydi — "pul olindi, lekin buyurtma bekor" holati
 * bo'lmaydi.
 */
export async function lockOrder(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM customer_order WHERE id = ${orderId} FOR UPDATE`;
}
