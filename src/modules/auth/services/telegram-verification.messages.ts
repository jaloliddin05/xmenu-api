import { BotLang, escapeHtml } from './telegram-verification.util';

interface Messages {
  greeting: string;
  askContact: (brand: string) => string;
  shareButton: string;
  verified: string;
  code: (brand: string, code: string) => string;
  notYourContact: string;
  onlyUzbek: string;
  phoneMismatch: string;
  expired: string;
  wrongAccount: string;
  alreadyDone: string;
  tooMany: string;
  failed: string;
}

const b = (brand: string) => escapeHtml(brand);

/** Bot replies (parse_mode=HTML): brand names are escaped, nothing else is user-controlled. */
export const BOT_MESSAGES: Record<BotLang, Messages> = {
  ru: {
    greeting: 'Откройте приложение ресторана, чтобы войти.',
    askContact: (brand) =>
      `Подтверждение номера для «${b(brand)}».\nНажмите кнопку ниже, чтобы поделиться номером телефона.`,
    shareButton: 'Поделиться номером',
    verified: '✅ Номер подтверждён. Вернитесь в приложение.',
    code: (brand, code) =>
      `Код для входа в «${b(brand)}»: <b>${code}</b>\nНикому не сообщайте этот код.`,
    notYourContact:
      'Отправьте свой собственный номер кнопкой «Поделиться номером».',
    onlyUzbek: 'Сейчас поддерживаются только номера Узбекистана (+998).',
    phoneMismatch:
      'Этот номер не совпадает с номером в приложении. Проверьте номер и начните заново.',
    expired: 'Сессия истекла. Вернитесь в приложение и начните заново.',
    wrongAccount: 'Эта ссылка предназначена для другого аккаунта Telegram.',
    alreadyDone: 'Номер уже подтверждён. Вернитесь в приложение.',
    tooMany: 'Слишком много попыток. Попробуйте позже.',
    failed: 'Не удалось отправить код. Попробуйте ещё раз.',
  },
  uz: {
    greeting: 'Kirish uchun restoran ilovasini oching.',
    askContact: (brand) =>
      `«${b(brand)}» uchun raqamni tasdiqlash.\nTelefon raqamingizni yuborish uchun quyidagi tugmani bosing.`,
    shareButton: 'Raqamni yuborish',
    verified: '✅ Raqam tasdiqlandi. Ilovaga qayting.',
    code: (brand, code) =>
      `«${b(brand)}» ga kirish kodi: <b>${code}</b>\nBu kodni hech kimga bermang.`,
    notYourContact:
      'Faqat o‘zingizning raqamingizni «Raqamni yuborish» tugmasi orqali yuboring.',
    onlyUzbek:
      'Hozircha faqat O‘zbekiston raqamlari (+998) qo‘llab-quvvatlanadi.',
    phoneMismatch:
      'Bu raqam ilovadagi raqamga mos kelmadi. Raqamni tekshirib, qaytadan boshlang.',
    expired: 'Sessiya tugadi. Ilovaga qayting va qaytadan boshlang.',
    wrongAccount: 'Bu havola boshqa Telegram akkaunti uchun mo‘ljallangan.',
    alreadyDone: 'Raqam allaqachon tasdiqlangan. Ilovaga qayting.',
    tooMany: 'Juda ko‘p urinish. Keyinroq urinib ko‘ring.',
    failed: 'Kodni yuborib bo‘lmadi. Qaytadan urinib ko‘ring.',
  },
  en: {
    greeting: 'Open the restaurant app to sign in.',
    askContact: (brand) =>
      `Phone verification for “${b(brand)}”.\nTap the button below to share your phone number.`,
    shareButton: 'Share phone number',
    verified: '✅ Phone number confirmed. Return to the app.',
    code: (brand, code) =>
      `Your sign-in code for “${b(brand)}”: <b>${code}</b>\nDo not share this code with anyone.`,
    notYourContact:
      'Please share your own number with the “Share phone number” button.',
    onlyUzbek: 'Only Uzbekistan numbers (+998) are supported for now.',
    phoneMismatch:
      'This number does not match the one in the app. Check it and start again.',
    expired: 'The session has expired. Return to the app and start again.',
    wrongAccount: 'This link was issued for a different Telegram account.',
    alreadyDone: 'The phone number is already confirmed. Return to the app.',
    tooMany: 'Too many attempts. Please try again later.',
    failed: 'Could not send the code. Please try again.',
  },
};
