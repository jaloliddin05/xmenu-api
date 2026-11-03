import axios from 'axios';

const TELEGRAM_TOKEN = process.env.OTP_BOT || '';
const CHAT_ID = process.env.XMENU_CHAT_ID || '';

// Plain Bot API call. The token is part of the URL, so a failure is rethrown
// with the Telegram description only: axios errors carry the request URL.
async function sendMessage(chatId: string, text: string): Promise<void> {
  try {
    await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
      { chat_id: chatId, text },
      { timeout: 8000 },
    );
  } catch (e) {
    const description = axios.isAxiosError<{ description?: string }>(e)
      ? (e.response?.data?.description ?? e.code ?? 'request failed')
      : 'request failed';
    throw new Error(`Telegram sendMessage failed: ${description}`);
  }
}

// SmsProvider=telegram uchun: mijoz va egasi (staff) OTP'lari shu orqali
// guruhga boradi (CustomerOtpService scope bo'yicha matnni tayyorlaydi).
//
// Loyiha davomida: SMS_PROVIDER=telegram (customer-auth.config.ts) — real
// Eskiz hisobisiz ham jamoa OTP kodlarini shu guruhda ko'rib test qila
// oladi. Loyiha yakunlanganda bitta joyni o'zgartirish kifoya:
// SMS_PROVIDER=eskiz (+ ESKIZ_EMAIL/ESKIZ_PASSWORD) — kod o'zgarmaydi.
//
// `text` CustomerOtpService tomonidan allaqachon to'liq render qilingan,
// tenant nomi va kodni o'z ichiga oladi (masalan: "Код для входа в Mant: 1234...").
// Parse_mode ataylab qo'yilmagan — tenant.brandName ichida Markdown maxsus
// belgisi (*, _, `) bo'lsa, Telegram xabarni rad etib yuborishi mumkin edi,
// bu esa har bir otp/request'ni shu tenant uchun 503 bilan sindirar edi.
export async function sendCustomerOtpSms(
  phone: string,
  text: string,
): Promise<void> {
  const message = `🧪 Test SMS → ${phone}\n${text}`;

  await sendMessage(CHAT_ID, message);
}

// Landing form notification. Returns false without any network call when the bot is not
// configured. Plain text on purpose (see above): a name with _ * [ must not break the message.
export async function sendApplicationToTelegram(data: {
  fullName?: string;
  phone?: string;
  from?: string;
  plan?: string;
  description?: string;
}): Promise<boolean> {
  if (!TELEGRAM_TOKEN || !CHAT_ID) return false;

  const lines = ['📝 Yangi zayavka!'];
  if (data.fullName) lines.push(`👤 Ism: ${data.fullName}`);
  if (data.phone) lines.push(`📞 Telefon: ${data.phone}`);
  if (data.from) lines.push(`📍 Qayerdan: ${data.from}`);
  if (data.plan) lines.push(`💰 Tarif: ${data.plan}`);
  if (data.description) lines.push(`🗒️ Izoh: ${data.description}`);
  const message = lines.join('\n');

  await sendMessage(CHAT_ID, message);
  return true;
}
