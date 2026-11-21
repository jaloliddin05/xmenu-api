export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsSendOptions {
  /** The venue the SMS is sent for: counted towards its daily ceiling too. None: the platform's own (owners). */
  tenantId?: string;
}

export interface SmsProvider {
  /** phone — E.164 (+998...). Xatoda throw qiladi. Avtoqayta urinish YO'Q (SMS ikki marta ketmasin). */
  send(phone: string, text: string, opts?: SmsSendOptions): Promise<void>;
}
