import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { SmsProvider } from './sms-provider.interface';

const BASE = 'https://notify.eskiz.uz/api';
const TIMEOUT_MS = 5000;

@Injectable()
export class EskizSmsProvider implements SmsProvider {
  private readonly logger = new Logger('EskizSms');
  private token: string | null = null;

  private async login(): Promise<string> {
    const email = process.env.ESKIZ_EMAIL;
    const password = process.env.ESKIZ_PASSWORD;
    if (!email || !password) throw new Error('ESKIZ_EMAIL / ESKIZ_PASSWORD sozlanmagan');

    const form = new URLSearchParams({ email, password });
    const res = await axios.post(`${BASE}/auth/login`, form, { timeout: TIMEOUT_MS });
    const token = res.data?.data?.token;
    if (!token) throw new Error('Eskiz login: token qaytmadi');
    this.token = token;
    return token;
  }

  private async post(phone: string, text: string, token: string) {
    const form = new URLSearchParams({
      mobile_phone: phone.replace(/^\+/, ''),
      message: text,
      from: process.env.ESKIZ_FROM || '4546',
    });
    return axios.post(`${BASE}/message/sms/send`, form, {
      timeout: TIMEOUT_MS,
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async send(phone: string, text: string): Promise<void> {
    const token = this.token ?? (await this.login());
    try {
      await this.post(phone, text, token);
    } catch (err: any) {
      // Token eskirgan bo'lsa — bir marta qayta login, so'ng yana yuboriladi
      // (birinchi so'rov 401 bilan rad etilgani uchun SMS ketmagan).
      if (err?.response?.status === 401) {
        const fresh = await this.login();
        await this.post(phone, text, fresh);
        return;
      }
      this.logger.error(`Eskiz xatosi: status=${err?.response?.status ?? 'n/a'} ${err?.message}`);
      throw err;
    }
  }
}
