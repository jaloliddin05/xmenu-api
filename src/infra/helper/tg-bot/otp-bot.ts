import TelegramBot from 'node-telegram-bot-api';

const TELEGRAM_TOKEN = process.env.OTP_BOT || '';
const CHAT_ID = process.env.XMENU_CHAT_ID || '';

const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: false });

export async function sendOtpWithButton(code: number | string,phone) {
  const message = `📩 Your code is \`${code}\` \n 📞 Phone: \*${phone}\*`

  await bot.sendMessage(CHAT_ID, message, {
    parse_mode: 'Markdown',
  });

  return code;
}

export async function sendUserPassword(password: string,phone, firstName, lastName) {
  const message = `\*${firstName + ' ' + lastName}\* \n 📩 Your password is \`${password}\` \n 📞 Phone: \*${phone}\*`

  await bot.sendMessage(CHAT_ID, message, {
    parse_mode: 'Markdown',
  });

  return password;
}


export async function sendApplicationToTelegram(data: {
  fullName?: string;
  phone?: string;
  from?: string;
  tarif?: string;
  description?: string;
}) {
  let message = `📝 *Yangi zayavka!*`;

  if (data.fullName) message += `\n👤 Ism: *${data.fullName}*`;
  if (data.phone) message += `\n📞 Telefon: *${data.phone}*`;
  if (data.from) message += `\n📍 Qayerdan: *${data.from}*`;
  if (data.tarif) message += `\n💰 Tarif: *${data.tarif}*`;
  if (data.description) message += `\n🗒️ Izoh: *${data.description}*`;

  await bot.sendMessage(CHAT_ID, message, { parse_mode: 'Markdown' });
}