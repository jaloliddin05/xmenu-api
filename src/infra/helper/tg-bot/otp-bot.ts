import TelegramBot from 'node-telegram-bot-api';

const TELEGRAM_TOKEN = process.env.OTP_BOT || '';
const CHAT_ID = process.env.XMENU_CHAT_ID || '';

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

export async function sendOtpWithButton(code: number | string, phone) {
  const message = `📩 Your code is \`${code}\` \n 📞 Phone: \*${phone}\*`;

  await bot.sendMessage(CHAT_ID, message, {
    parse_mode: 'Markdown',
  });

  return code;
}

// Mijoz (customer) OTP'lari uchun alohida funksiya — sendOtpWithButton'ni
// QAYTA ISHLATMANG: u xodimlar (staff) oqimida band (auth.service.ts, login
// va parolni tiklash), signature'si ham boshqa narsa uchun mo'ljallangan.
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

  await bot.sendMessage(CHAT_ID, message);
}

export async function sendUserPassword(
  password: string,
  phone,
  firstName,
  lastName,
) {
  const message = `\*${firstName + ' ' + lastName}\* \n 📩 Your password is \`${password}\` \n 📞 Phone: \*${phone}\*`;

  await bot.sendMessage(CHAT_ID, message, {
    parse_mode: 'Markdown',
  });

  return password;
}

export async function sendApplicationToTelegram(data: {
  fullName?: string;
  phone?: string;
  from?: string;
  plan?: string;
  description?: string;
}) {
  let message = `📝 *Yangi zayavka!*`;

  if (data.fullName) message += `\n👤 Ism: *${data.fullName}*`;
  if (data.phone) message += `\n📞 Telefon: *${data.phone}*`;
  if (data.from) message += `\n📍 Qayerdan: *${data.from}*`;
  if (data.plan) message += `\n💰 Tarif: *${data.plan}*`;
  if (data.description) message += `\n🗒️ Izoh: *${data.description}*`;

  await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
}
