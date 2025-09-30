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
