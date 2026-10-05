export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsProvider {
  /** phone — E.164 (+998...). Xatoda throw qiladi. Avtoqayta urinish YO'Q (SMS ikki marta ketmasin). */
  send(phone: string, text: string): Promise<void>;
}
